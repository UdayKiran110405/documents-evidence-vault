
import json
import uuid

from datetime import datetime, timezone
from pathlib import Path

from database import save_recovery_manifest


MANIFEST_DIRECTORY = (
    Path(__file__).resolve().parent / "manifests"
)


def create_recovery_manifest(
    document_id: int,
    failure_type: str,
    source_region: str,
    destination_region: str,
    source_version_id: str,
    recovered_version_id: str,
    expected_checksum: str,
    source_checksum: str,
    recovered_checksum: str,
    file_size: int,
    rto_seconds: float,
    verification_status: str,
    recovery_result: dict = None
):
    """
    Create a portable JSON recovery manifest and persist its
    database record.

    The JSON file is retained if the MySQL insert fails so that
    the evidence can be reconciled instead of silently discarded.
    """

    if not document_id:
        raise ValueError("Document ID is required")

    if not source_version_id or not recovered_version_id:
        raise ValueError("Both source and recovered version IDs are required")

    if file_size < 0:
        raise ValueError("File size cannot be negative")

    recovery_result = recovery_result or {}

    MANIFEST_DIRECTORY.mkdir(
        parents=True,
        exist_ok=True
    )

    manifest_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    manifest = {
        "manifest_id": manifest_id,
        "document_id": document_id,
        "failure_type": failure_type,
        "source_region": source_region,
        "destination_region": destination_region,
        "source_version_id": source_version_id,
        "recovered_version_id": recovered_version_id,
        "expected_checksum": expected_checksum,
        "source_checksum": source_checksum,
        "recovered_checksum": recovered_checksum,
        "file_size_bytes": file_size,
        "rto_seconds": round(float(rto_seconds), 3),
        "verification_status": verification_status,
        "source_verified": recovery_result.get(
            "source_verified"
        ),
        "destination_verified": recovery_result.get(
            "destination_verified"
        ),
        "database_updated": recovery_result.get(
            "database_updated"
        ),
        "recovery_duration_seconds": recovery_result.get(
            "recovery_duration_seconds"
        ),
        "recovery_started_at": recovery_result.get(
            "recovery_started_at"
        ),
        "recovery_completed_at": recovery_result.get(
            "recovery_completed_at"
        ),
        "created_at": created_at
    }

    manifest_path = (
        MANIFEST_DIRECTORY
        / f"recovery-{manifest_id}.json"
    )

    temporary_path = manifest_path.with_suffix(".json.tmp")

    manifest_json = json.dumps(
        manifest,
        indent=4,
        ensure_ascii=False
    )

    # Write to a temporary file first, then atomically rename it.
    temporary_path.write_text(
        manifest_json,
        encoding="utf-8"
    )

    temporary_path.replace(manifest_path)

    # Persist the manifest metadata in MySQL.
    try:
        save_recovery_manifest(
            manifest,
            str(manifest_path)
        )

    except Exception as error:
        raise RuntimeError(
            "Recovery JSON manifest was created, but its MySQL "
            "record could not be saved. "
            f"Manifest file retained at: {manifest_path}"
        ) from error

    return {
        "manifest_id": manifest_id,
        "manifest_path": str(manifest_path),
        "manifest": manifest,
        "database_saved": True
    }
