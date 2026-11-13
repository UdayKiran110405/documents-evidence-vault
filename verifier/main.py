
import logging

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

from database import (
    create_drill_table,
    save_drill_result,
    get_drill_history,
    create_manifest_table,
    get_recovery_manifests,
    create_metrics_table,
    save_dr_metrics,
    get_dr_metrics,
    get_document
)

from manifest import create_recovery_manifest
from verification import verify_document
from recovery import recover_document
from metrics import (
    calculate_rto,
    estimate_rpo_seconds,
    track_replication
)
from corruption import simulate_primary_corruption

import secrets

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from config import PYTHON_SERVICE_TOKEN

import json
import time
from fastapi.responses import StreamingResponse
from botocore.exceptions import ClientError
from config import PRIMARY_BUCKET, SECONDARY_BUCKET, PRIMARY_REGION, SECONDARY_REGION
from s3_client import primary_s3, secondary_s3
from database import get_all_active_documents
from etl_to_snowflake import extract_mysql_data, load_into_snowflake


logger = logging.getLogger("evidence-vault.dr")


@asynccontextmanager
async def lifespan(app: FastAPI):

    if not PYTHON_SERVICE_TOKEN:
        raise RuntimeError(
            "PYTHON_SERVICE_TOKEN is missing. "
            "Configure it in the project root .env file."
        )

    create_drill_table()
    create_manifest_table()
    create_metrics_table()

    yield

app = FastAPI(
    title="Document Evidence Vault - DR Verification API",
    description=(
        "Independent document integrity verification "
        "and disaster recovery service"
    ),
    version="2.0.0",
    lifespan=lifespan
)

@app.middleware("http")
async def authenticate_internal_service(
    request: Request,
    call_next
):
    # Protect all internal API endpoints.
    if request.url.path.startswith("/api/v1/"):

        provided_token = request.headers.get(
            "X-Service-Token",
            ""
        )

        if not PYTHON_SERVICE_TOKEN:
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Service authentication is not configured"
                }
            )

        if not secrets.compare_digest(
            provided_token,
            PYTHON_SERVICE_TOKEN
        ):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Unauthorized service request"
                }
            )

    return await call_next(request)


def _observe_recovery_replication(
    document_id: int,
    recovery_result: dict
):
    """
    Observe CRR status for the exact newly recovered primary version.
    """

    document = get_document(document_id)

    if not document:
        raise ValueError(
            "Document disappeared while recording recovery metrics"
        )

    upload_started_at = datetime.fromisoformat(
        recovery_result["upload_started_at"]
    )

    return track_replication(
        storage_key=document["storage_key"],
        version_id=recovery_result["new_primary_version_id"],
        upload_started_at=upload_started_at,
        timeout_seconds=60,
        interval_seconds=2
    )



def record_recovery_metrics(
    document_id: int,
    failure_type: str,
    recovery_result: dict,
    before: dict,
    drill_duration: float,
    replication: dict
):
    """
    Persist recovery RTO separately from total drill duration.
    """

    recovery_rto = recovery_result.get(
        "recovery_duration_seconds"
    )

    if recovery_rto is None:
        raise ValueError(
            "Recovery result does not contain a measured RTO"
        )

    estimated_rpo = estimate_rpo_seconds(
        before.get("primary"),
        before.get("secondary")
    )

    metrics = {
        "document_id": document_id,
        "failure_type": failure_type,
        "recovered_version_id": (
            recovery_result["new_primary_version_id"]
        ),
        "recovery_workflow_seconds": recovery_rto,
        "recovery_rto_seconds": recovery_rto,
        "drill_duration_seconds": drill_duration,
        "estimated_rpo_seconds": estimated_rpo,
        "replication_status": replication["replication_status"],
        "replication_observation_seconds": (
            replication.get("replication_observation_seconds")
        ),
        "replication_timed_out": replication.get(
            "timed_out", False
        ),
        "replication_error_code": replication.get("error_code")
    }

    save_dr_metrics(metrics)

    return metrics

def _create_drill_result(
    document_id: int,
    before: dict,
    after: dict,
    recovery_performed: bool,
    rto_seconds: float,
    failure_type: str = "NONE",
    corruption_detected: bool = False,
    replication_lag_seconds: float = None
):
    """
    Build a consistent DR drill record for database persistence.
    """

    primary_verified = after["primary"]["verified"]
    secondary_verified = after["secondary"]["verified"]

    if primary_verified and secondary_verified:
        status = "SUCCESS"
    elif secondary_verified:
        status = "RECOVERY_REQUIRED"
    else:
        status = "FAILED"

    return {
        "document_id": document_id,
        "primary_verified": primary_verified,
        "secondary_verified": secondary_verified,
        "recovery_performed": recovery_performed,
        "drill_status": status,
        "replication_lag_seconds": replication_lag_seconds,
        "rto_seconds": rto_seconds,
        "expected_checksum": after["expected_checksum"],
        "primary_checksum": after["primary"].get(
            "actual_checksum"
        ),
        "secondary_checksum": after["secondary"].get(
            "actual_checksum"
        ),
        "corruption_detected": corruption_detected,
        "failure_type": failure_type,
        "recovery_source": (
            "Singapore" if recovery_performed else None
        )
    }

def _create_manifest_for_recovery(
    document_id: int,
    failure_type: str,
    before: dict,
    after: dict,
    recovery_result: dict,
    rto_seconds: float,
    drill_status: str
):
    """
    Create a manifest using the actual verified recovery result.
    """

    return create_recovery_manifest(
        document_id=document_id,
        failure_type=failure_type,
        source_region="ap-southeast-1",
        destination_region="ap-south-1",
        source_version_id=(
            recovery_result["selected_source_version_id"]
        ),
        recovered_version_id=(
            recovery_result["new_primary_version_id"]
        ),
        expected_checksum=after["expected_checksum"],
        source_checksum=(
            recovery_result["source_checksum"]
        ),
        recovered_checksum=(
            recovery_result["recovered_checksum"]
        ),
        file_size=after["primary"]["size_bytes"],
        rto_seconds=rto_seconds,
        verification_status=drill_status,
        recovery_result=recovery_result
    )

def _run_recovery_observation(
    document_id: int,
    failure_type: str,
    before: dict,
    recovery_result: dict,
    started_at: datetime
):
    """
    Wait for the replication observation, verify the final state,
    and persist the drill, manifest and metrics.
    """

    replication = _observe_recovery_replication(
        document_id,
        recovery_result
    )

    # Verify after the replication observation.
    after = verify_document(document_id)

    completed_at = datetime.now(timezone.utc)

    # RTO ends when recovery and the MySQL update have completed.
    rto_seconds = recovery_result["recovery_duration_seconds"]

    # Drill duration also includes replication observation and final checks.
    drill_duration = calculate_rto(
        started_at,
        completed_at
    )

    drill_result = _create_drill_result(
        document_id=document_id,
        before=before,
        after=after,
        recovery_performed=True,
        rto_seconds=rto_seconds,
        failure_type=failure_type,
        corruption_detected=(
            failure_type == "SIMULATED_CORRUPTION"
        ),
        replication_lag_seconds=replication.get(
            "replication_observation_seconds"
        )
    )

    save_drill_result(drill_result)

    manifest_result = _create_manifest_for_recovery(
        document_id=document_id,
        failure_type=failure_type,
        before=before,
        after=after,
        recovery_result=recovery_result,
        rto_seconds=rto_seconds,
        drill_status=drill_result["drill_status"]
    )

    metrics_result = record_recovery_metrics(
        document_id=document_id,
        failure_type=failure_type,
        recovery_result=recovery_result,
        before=before,
        drill_duration=drill_duration,
        replication=replication
    )

    return {
        "recovery": recovery_result,
        "verification": after,
        "drill": drill_result,
        "manifest": manifest_result,
        "metrics": metrics_result,
        "drill_duration_seconds": drill_duration
    }

@app.get("/")
def root():
    return {
        "application": "Document Evidence Vault DR Service",
        "status": "RUNNING",
        "version": "2.0.0"
    }


@app.get("/health")
def health():
    return {
        "status": "UP",
        "service": "Python DR Verification Service"
    }


@app.post("/api/v1/verify/{document_id}")
def verify(document_id: int):
    try:
        return verify_document(document_id)

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        logger.exception(
            "Verification failed for document %s",
            document_id
        )
        raise HTTPException(
            status_code=500,
            detail="Document verification failed"
        ) from error


@app.post("/api/v1/recover/{document_id}")
def recover(
    document_id: int,
    version_id: str = None
):
    try:
        return recover_document(
            document_id=document_id,
            version_id=version_id
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        logger.exception(
            "Recovery failed for document %s",
            document_id
        )
        raise HTTPException(
            status_code=500,
            detail=str(error)
        ) from error


@app.post("/api/v1/drills/run/{document_id}")
def run_drill(document_id: int):
    started_at = datetime.now(timezone.utc)

    try:
        before = verify_document(document_id)

        primary_verified = before["primary"]["verified"]
        secondary_verified = before["secondary"]["verified"]

        recovery_result = None
        replication = None
        recovery_performed = False

        if not primary_verified and secondary_verified:
            recovery_result = recover_document(document_id)
            recovery_performed = True

            replication = _observe_recovery_replication(
                document_id,
                recovery_result
            )

            after = verify_document(document_id)

        else:
            after = before

        completed_at = datetime.now(timezone.utc)

        drill_duration = calculate_rto(
            started_at,
            completed_at
        )

        rto_seconds = (
            recovery_result["recovery_duration_seconds"]
            if recovery_performed
            else drill_duration
        )

        drill_result = _create_drill_result(
            document_id=document_id,
            before=before,
            after=after,
            recovery_performed=recovery_performed,
            rto_seconds=rto_seconds
        )

        save_drill_result(drill_result)

        manifest_result = None
        metrics_result = None

        if recovery_performed:
            manifest_result = _create_manifest_for_recovery(
                document_id=document_id,
                failure_type="SIMULATED_PRIMARY_FAILURE",
                before=before,
                after=after,
                recovery_result=recovery_result,
                rto_seconds=rto_seconds,
                drill_status=drill_result["drill_status"]
            )

            metrics_result = record_recovery_metrics(
                document_id=document_id,
                failure_type="SIMULATED_PRIMARY_FAILURE",
                recovery_result=recovery_result,
                before=before,
                drill_duration=drill_duration,
                replication=replication
            )

        return {
            "simulation": "AUTOMATED_DR_CHECK",
            "before_recovery": before,
            "recovery": recovery_result,
            "after_recovery": after,
            "drill": drill_result,
            "manifest": manifest_result,
            "drill_duration_seconds": drill_duration,
            "metrics": metrics_result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        logger.exception(
            "Automated DR drill failed for document %s",
            document_id
        )
        raise HTTPException(
            status_code=500,
            detail="Automated disaster recovery drill failed"
        ) from error


@app.get("/api/v1/drills")
def drills():
    try:
        return get_drill_history()

    except Exception as error:
        logger.exception("Could not retrieve DR drill history")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve DR drill history"
        ) from error


@app.post(
    "/api/v1/drills/simulate-primary-failure/{document_id}"
)
def simulate_primary_failure(document_id: int):
    started_at = datetime.now(timezone.utc)

    try:
        # Capture the current state without modifying either bucket.
        before = verify_document(document_id)

        if not before["secondary"]["verified"]:
            raise ValueError(
                "Simulation stopped: Singapore replica failed "
                "integrity verification. Recovery is unsafe."
            )

        # This is a controlled primary-failure assumption.
        # It does not delete or disable the Mumbai S3 object.
        recovery_result = recover_document(document_id)

        result = _run_recovery_observation(
            document_id=document_id,
            failure_type="SIMULATED_PRIMARY_FAILURE",
            before=before,
            recovery_result=recovery_result,
            started_at=started_at
        )

        return {
            "simulation": "PRIMARY_UNAVAILABLE_ASSUMED",
            "before_recovery": before,
            **result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        logger.exception(
            "Primary failure drill failed for document %s",
            document_id
        )
        raise HTTPException(
            status_code=500,
            detail="Primary failure recovery drill failed"
        ) from error


@app.post(
    "/api/v1/drills/simulate-corruption/{document_id}"
)
def simulate_corruption_drill(document_id: int):
    started_at = datetime.now(timezone.utc)

    try:
        # Capture the exact database-selected version in both regions.
        before = verify_document(document_id)

        # Corruption is simulated in memory only.
        corruption = simulate_primary_corruption(document_id)

        if not corruption["corruption_detected"]:
            raise ValueError(
                "Corruption simulation failed to detect "
                "a checksum mismatch"
            )

        # The secondary copy must be clean before recovery.
        if not before["secondary"]["verified"]:
            raise ValueError(
                "Singapore replica failed verification. "
                "Recovery stopped to protect evidence integrity."
            )

        recovery_result = recover_document(document_id)

        result = _run_recovery_observation(
            document_id=document_id,
            failure_type="SIMULATED_CORRUPTION",
            before=before,
            recovery_result=recovery_result,
            started_at=started_at
        )

        return {
            "simulation": "CORRUPTION_DETECTED",
            "corruption_details": corruption,
            "secondary_verification": before["secondary"],
            **result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        logger.exception(
            "Corruption recovery drill failed for document %s",
            document_id
        )
        raise HTTPException(
            status_code=500,
            detail="Corruption recovery drill failed"
        ) from error


@app.get("/api/v1/manifests")
def list_manifests():
    try:
        return get_recovery_manifests()

    except Exception as error:
        logger.exception("Could not retrieve recovery manifests")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve recovery manifests"
        ) from error


@app.get("/api/v1/metrics")
def list_metrics():
    try:
        return get_dr_metrics()

    except Exception as error:
        logger.exception("Could not retrieve DR metrics")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve DR metrics"
        ) from error


from etl_to_snowflake import extract_mysql_data, load_into_snowflake

@app.post("/api/v1/etl/snowflake-sync")
def trigger_snowflake_sync():
    try:
        extracted = extract_mysql_data()
        load_into_snowflake(extracted)
        counts = {table: len(rows) for table, rows in extracted.items()}
        return {
            "status": "SUCCESS",
            "synced_tables": counts,
            "total_rows_synced": sum(counts.values()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as error:
        logger.exception("Snowflake ETL sync failed")
        raise HTTPException(
            status_code=500,
            detail=f"Snowflake sync failed: {str(error)}"
        ) from error


@app.get("/api/v1/regions/status")
def multi_region_inventory_status():
    """
    Scan all active/corrupted documents across Mumbai (ap-south-1)
    and Singapore (ap-southeast-1) using lightweight HEAD metadata checks.
    """
    docs = get_all_active_documents()
    items = []
    synced_count = 0
    replicating_count = 0

    for doc in docs:
        key = doc["storage_key"]
        ver_id = doc.get("latest_s3_version_id")

        primary_info = {"exists": False, "replication_status": "UNKNOWN", "size_bytes": None}
        secondary_info = {"exists": False, "size_bytes": None}

        if ver_id:
            try:
                p_head = primary_s3.head_object(
                    Bucket=PRIMARY_BUCKET,
                    Key=key,
                    VersionId=ver_id
                )
                primary_info = {
                    "exists": True,
                    "replication_status": p_head.get("ReplicationStatus", "COMPLETED"),
                    "size_bytes": p_head.get("ContentLength"),
                    "last_modified": p_head["LastModified"].isoformat() if p_head.get("LastModified") else None
                }
            except ClientError:
                pass

            try:
                s_head = secondary_s3.head_object(
                    Bucket=SECONDARY_BUCKET,
                    Key=key,
                    VersionId=ver_id
                )
                secondary_info = {
                    "exists": True,
                    "size_bytes": s_head.get("ContentLength"),
                    "last_modified": s_head["LastModified"].isoformat() if s_head.get("LastModified") else None
                }
            except ClientError:
                pass

        parity = (
            primary_info["exists"]
            and secondary_info["exists"]
            and primary_info["size_bytes"] == secondary_info["size_bytes"]
        )

        if parity:
            synced_count += 1
        else:
            replicating_count += 1

        items.append({
            "document_id": doc["id"],
            "filename": doc["original_filename"],
            "category": doc["category"],
            "status": doc["status"],
            "version_id": ver_id,
            "expected_checksum": doc["sha256_checksum"],
            "primary": primary_info,
            "secondary": secondary_info,
            "parity_verified": parity
        })

    return {
        "primary_region": PRIMARY_REGION,
        "primary_bucket": PRIMARY_BUCKET,
        "secondary_region": SECONDARY_REGION,
        "secondary_bucket": SECONDARY_BUCKET,
        "total_documents": len(items),
        "synced_count": synced_count,
        "pending_or_drift_count": replicating_count,
        "documents": items
    }


@app.get("/api/v1/drills/stream/{document_id}")
def stream_drill_execution(document_id: int, mode: str = "outage"):
    """
    Stream live step-by-step DR drill events via Server-Sent Events (SSE)
    with explicit chunk flushing so logs appear in real time during the drill.
    """
    def event_stream():
        t0 = time.perf_counter()
        started_at = datetime.now(timezone.utc)

        def emit(step: str, detail: str, level: str = "INFO", payload: dict = None):
            elapsed = round(time.perf_counter() - t0, 3)
            data = {
                "elapsed_seconds": elapsed,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "step": step,
                "detail": detail,
                "level": level,
                "payload": payload
            }
            # 2KB SSE comment padding forces immediate HTTP chunk flush across proxies
            padding = ":" + (" " * 2048) + "\n"
            return f"{padding}data: {json.dumps(data)}\n\n"

        try:
            yield emit("INIT", f"Initializing {mode.upper()} drill for Document #{document_id}...", "INFO")
            before = verify_document(document_id)
            yield emit(
                "PRE_CHECK",
                f"Mumbai verified={before['primary']['verified']} | Singapore verified={before['secondary']['verified']}",
                "SUCCESS" if before["secondary"]["verified"] else "ERROR",
                {"before": before}
            )

            if mode == "corruption":
                yield emit("CORRUPT_SIM", "Simulating single-bit flip in Mumbai S3 byte stream...", "WARN")
                corr = simulate_primary_corruption(document_id)
                yield emit(
                    "CHECKSUM_MISMATCH",
                    f"SHA-256 mismatch caught! Expected {corr['expected_checksum'][:14]}... vs Corrupted {corr['corrupted_checksum'][:14]}...",
                    "WARN",
                    {"corruption": corr}
                )

            if mode == "normal" and before["primary"]["verified"] and before["secondary"]["verified"]:
                completed_at = datetime.now(timezone.utc)
                drill_duration = calculate_rto(started_at, completed_at)
                drill_res = _create_drill_result(
                    document_id=document_id,
                    before=before,
                    after=before,
                    recovery_performed=False,
                    rto_seconds=drill_duration,
                    failure_type="NONE"
                )
                save_drill_result(drill_res)
                yield emit(
                    "COMPLETED",
                    f"Both regions healthy in {drill_duration}s. No failover required.",
                    "SUCCESS",
                    {"drill": drill_res, "verification": before}
                )
                return

            if not before["secondary"]["verified"]:
                yield emit("ABORTED", "Singapore replica failed SHA-256 verification. Aborting recovery.", "ERROR")
                return

            failure_type = (
                "SIMULATED_CORRUPTION" if mode == "corruption" else "SIMULATED_PRIMARY_FAILURE"
            )
            yield emit("FAILOVER_PULL", "Downloading verified replica bytes from Singapore (ap-southeast-1)...", "INFO")
            recovery_result = recover_document(document_id)
            rto = recovery_result["recovery_duration_seconds"]

            yield emit(
                "RTO_ACHIEVED",
                f"Evidence restored to Mumbai (ap-south-1) & MySQL updated in {rto}s! (Target < 5.0s)",
                "SUCCESS",
                {"recovery": recovery_result}
            )

            yield emit(
                "CRR_POLLING",
                "Evidence is live in Mumbai! Polling AWS S3 Cross-Region Replication to Singapore...",
                "INFO"
            )

            upload_started_at = datetime.fromisoformat(recovery_result["upload_started_at"])
            poll_deadline = time.monotonic() + 60
            replication = None
            attempt = 0

            while True:
                attempt += 1
                replication = track_replication(
                    storage_key=before["primary"].get("storage_key") or get_document(document_id)["storage_key"],
                    version_id=recovery_result["new_primary_version_id"],
                    upload_started_at=upload_started_at,
                    timeout_seconds=0,
                    interval_seconds=2
                )
                status = replication["replication_status"]
                if status in ("COMPLETED", "FAILED", "NOT_AVAILABLE") or time.monotonic() >= poll_deadline:
                    break
                yield emit(
                    "CRR_WAIT",
                    f"AWS CRR status: {status} (check #{attempt}) — waiting for Singapore replica sync...",
                    "INFO"
                )
                time.sleep(3)
            replication = _observe_recovery_replication(document_id, recovery_result)
            after = verify_document(document_id)
            completed_at = datetime.now(timezone.utc)
            drill_duration = calculate_rto(started_at, completed_at)

            drill_res = _create_drill_result(
                document_id=document_id,
                before=before,
                after=after,
                recovery_performed=True,
                rto_seconds=rto,
                failure_type=failure_type,
                corruption_detected=(mode == "corruption"),
                replication_lag_seconds=replication.get("replication_observation_seconds")
            )
            save_drill_result(drill_res)

            manifest_res = _create_manifest_for_recovery(
                document_id=document_id,
                failure_type=failure_type,
                before=before,
                after=after,
                recovery_result=recovery_result,
                rto_seconds=rto,
                drill_status=drill_res["drill_status"]
            )
            metrics_res = record_recovery_metrics(
                document_id=document_id,
                failure_type=failure_type,
                recovery_result=recovery_result,
                before=before,
                drill_duration=drill_duration,
                replication=replication
            )

            yield emit(
                "COMPLETED",
                f"Drill complete! RTO={rto}s | CRR Status={replication['replication_status']} | Manifest signed.",
                "SUCCESS",
                {
                    "recovery": recovery_result,
                    "verification": after,
                    "drill": drill_res,
                    "manifest": manifest_res,
                    "metrics": metrics_res,
                    "drill_duration_seconds": drill_duration
                }
            )
        except Exception as err:
            yield emit("ERROR", str(err), "ERROR")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
@app.post("/api/v1/etl/snowflake-sync")
def trigger_snowflake_sync():
    try:
        extracted = extract_mysql_data()
        load_into_snowflake(extracted)
        counts = {table: len(rows) for table, rows in extracted.items()}
        return {
            "status": "SUCCESS",
            "synced_tables": counts,
            "total_rows_synced": sum(counts.values()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as error:
        logger.exception("Snowflake ETL sync failed")
        raise HTTPException(
            status_code=500,
            detail=f"Snowflake sync failed: {str(error)}"
        ) from error