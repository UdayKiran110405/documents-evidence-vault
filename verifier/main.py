
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

from database import (
    create_drill_table,
    save_drill_result,
    get_drill_history,
    create_manifest_table,
    get_recovery_manifests
)

from database import (
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_drill_table()
    create_manifest_table()
    create_metrics_table()
    yield

app = FastAPI(
    title="Document Evidence Vault - DR Verification API",
    description="Independent document integrity verification and disaster recovery service",
    version="1.0.0",
    lifespan=lifespan
)


def record_recovery_metrics(
    document_id,
    failure_type,
    recovery_result,
    before,
    workflow_rto
):
    document = get_document(document_id)

    upload_started_at = datetime.fromisoformat(
        recovery_result["upload_started_at"]
    )

    replication = track_replication(
        storage_key=document["storage_key"],
        version_id=recovery_result["new_primary_version_id"],
        upload_started_at=upload_started_at,
        timeout_seconds=30
    )

    estimated_rpo = estimate_rpo_seconds(
        before["primary"],
        before["secondary"]
    )

    metrics = {
        "document_id": document_id,
        "failure_type": failure_type,
        "recovered_version_id": recovery_result["new_primary_version_id"],
        "recovery_workflow_seconds": workflow_rto,
        "estimated_rpo_seconds": estimated_rpo,
        "replication_status": replication["replication_status"],
        "replication_observation_seconds": (
            replication["replication_observation_seconds"]
        )
    }

    save_dr_metrics(metrics)

    return metrics



@app.get("/")
def root():
    return {
        "application": "Document Evidence Vault DR Service",
        "status": "RUNNING",
        "version": "1.0.0"
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
            status_code=404,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.post("/api/v1/recover/{document_id}")
def recover(document_id: int):
    try:
        result = recover_document(document_id)
        return result

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.post("/api/v1/drills/run/{document_id}")
def run_drill(document_id: int):

    start_time = datetime.now(timezone.utc)

    try:
        initial_result = verify_document(document_id)

        primary_verified = initial_result["primary"]["verified"]
        secondary_verified = initial_result["secondary"]["verified"]

        recovery_performed = False
        recovery_result = None

        if not primary_verified and secondary_verified:

            recovery_result = recover_document(document_id)
            recovery_performed = True

            # Verify both regions again after recovery.
            final_result = verify_document(document_id)

            primary_verified = final_result["primary"]["verified"]
            secondary_verified = final_result["secondary"]["verified"]

        else:
            final_result = initial_result

        end_time = datetime.now(timezone.utc)

        rto = calculate_rto(start_time, end_time)

        if primary_verified and secondary_verified:
            drill_status = "SUCCESS"
        elif secondary_verified:
            drill_status = "RECOVERY_REQUIRED"
        else:
            drill_status = "FAILED"

        drill_result = {
            "document_id": document_id,
            "primary_verified": primary_verified,
            "secondary_verified": secondary_verified,
            "recovery_performed": recovery_performed,
            "drill_status": drill_status,
            "replication_lag_seconds": None,
            "rto_seconds": rto,
            "expected_checksum": final_result["expected_checksum"],
            "primary_checksum": final_result["primary"].get(
                "actual_checksum"
            ),
            "secondary_checksum": final_result["secondary"].get(
                "actual_checksum"
            )
        }

        save_drill_result(drill_result)

        return {
            **drill_result,
            "recovery_result": recovery_result,
            "verification": final_result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.get("/api/v1/drills")
def drills():
    try:
        return get_drill_history()

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )



@app.post("/api/v1/drills/simulate-primary-failure/{document_id}")
def simulate_primary_failure(document_id: int):

    start_time = datetime.now(timezone.utc)

    try:
        # Step 1: Capture the condition before simulated recovery.
        before = verify_document(document_id)

        secondary_verified = before["secondary"]["verified"]

        if not secondary_verified:
            raise ValueError(
                "Simulation stopped: Singapore replica failed "
                "checksum verification. Recovery is unsafe."
            )

        # Step 2: Assume Mumbai is unavailable.
        # Do not delete or modify the existing primary object.
        # Recover a verified copy from Singapore.
        recovery_result = recover_document(document_id)

        # Step 3: Verify both regions after recovery.
        after = verify_document(document_id)

        end_time = datetime.now(timezone.utc)

        primary_verified = after["primary"]["verified"]
        secondary_verified = after["secondary"]["verified"]

        # Replication lag is measured before recovery.


        rto = calculate_rto(start_time, end_time)

        if primary_verified and secondary_verified:
            drill_status = "SUCCESS"
        else:
            drill_status = "FAILED"

        drill_result = {
            "document_id": document_id,
            "primary_verified": primary_verified,
            "secondary_verified": secondary_verified,
            "recovery_performed": True,
            "drill_status": drill_status,
            "replication_lag_seconds": None,
            "rto_seconds": rto,
            "expected_checksum": after["expected_checksum"],
            "primary_checksum": after["primary"].get(
                "actual_checksum"
            ),
            "secondary_checksum": after["secondary"].get(
                "actual_checksum"
            )
        }

        # Step 4: Persist the DR drill.
        save_drill_result(drill_result)


        manifest_result = create_recovery_manifest(
            document_id=document_id,
            failure_type="SIMULATED_PRIMARY_FAILURE",
            source_region="ap-southeast-1",
            destination_region="ap-south-1",
            source_version_id=before["secondary"]["version_id"],
            recovered_version_id=recovery_result["new_primary_version_id"],
            expected_checksum=after["expected_checksum"],
            source_checksum=before["secondary"]["actual_checksum"],
            recovered_checksum=after["primary"]["actual_checksum"],
            file_size=after["primary"]["size_bytes"],
            rto_seconds=rto,
            verification_status=drill_status
        )

        

        metrics_result = record_recovery_metrics(
        document_id=document_id,
        failure_type="SIMULATED_PRIMARY_FAILURE",
        recovery_result=recovery_result,
        before=before,
        workflow_rto=rto
        )

        return {
            "simulation": "PRIMARY_UNAVAILABLE_ASSUMED",
            "before_recovery": {
                "primary_verified": before["primary"]["verified"],
                "secondary_verified": before["secondary"]["verified"]
            },
            "recovery": recovery_result,
            "drill": drill_result,
            "after_recovery": after,
            "manifest": manifest_result,
            "metrics": metrics_result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.post("/api/v1/drills/simulate-corruption/{document_id}")
def simulate_corruption_drill(document_id: int):

    start_time = datetime.now(timezone.utc)

    try:
        # Step 1: Simulate corruption in memory.
        corruption = simulate_primary_corruption(document_id)

        if not corruption["corruption_detected"]:
            raise ValueError(
                "Corruption simulation failed to detect checksum mismatch"
            )

        # Step 2: Verify the secondary copy.
        from verification import verify_region

        secondary = verify_region(
            corruption["storage_key"],
            corruption["expected_checksum"],
            "secondary"
        )

        if not secondary["verified"]:
            raise ValueError(
                "Singapore replica failed verification. "
                "Recovery stopped to protect evidence integrity."
            )

        # Step 3: Recover valid content from Singapore.
        recovery_result = recover_document(document_id)

        # Step 4: Verify the recovered document in both regions.
        after = verify_document(document_id)

        end_time = datetime.now(timezone.utc)

        primary_verified = after["primary"]["verified"]
        secondary_verified = after["secondary"]["verified"]

        rto = calculate_rto(start_time, end_time)


        drill_status = (
            "SUCCESS"
            if primary_verified and secondary_verified
            else "FAILED"
        )

        drill_result = {
            "document_id": document_id,
            "primary_verified": primary_verified,
            "secondary_verified": secondary_verified,
            "recovery_performed": True,
            "drill_status": drill_status,
            "replication_lag_seconds": None,
            "rto_seconds": rto,
            "expected_checksum": after["expected_checksum"],
            "primary_checksum": after["primary"].get(
                "actual_checksum"
            ),
            "secondary_checksum": after["secondary"].get(
                "actual_checksum"
            ),
            "corruption_detected": True,
            "failure_type": "SIMULATED_CORRUPTION",
            "recovery_source": "Singapore"
        }

        # Step 5: Save the DR drill.
        save_drill_result(drill_result)


        manifest_result = create_recovery_manifest(
            document_id=document_id,
            failure_type="SIMULATED_CORRUPTION",
            source_region="ap-southeast-1",
            destination_region="ap-south-1",
            source_version_id=secondary["version_id"],
            recovered_version_id=recovery_result["new_primary_version_id"],
            expected_checksum=after["expected_checksum"],
            source_checksum=secondary["actual_checksum"],
            recovered_checksum=after["primary"]["actual_checksum"],
            file_size=after["primary"]["size_bytes"],
            rto_seconds=rto,
            verification_status=drill_status
        )
        metrics_result = record_recovery_metrics(
            document_id=document_id,
            failure_type="SIMULATED_CORRUPTION",
            recovery_result=recovery_result,
            before={
                "primary": {
                    "exists": False
                },
                "secondary": secondary
            },
            workflow_rto=rto
        )

        return {
            "simulation": "CORRUPTION_DETECTED",
            "corruption_details": corruption,
            "secondary_verification": secondary,
            "recovery": recovery_result,
            "drill": drill_result,
            "final_verification": after,
            "manifest": manifest_result,
            "metrics": metrics_result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )



@app.get("/api/v1/manifests")
def list_manifests():
    try:
        return get_recovery_manifests()

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

@app.get("/api/v1/metrics")
def list_metrics():
    try:
        return get_dr_metrics()

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )