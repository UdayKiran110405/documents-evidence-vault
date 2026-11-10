
import json
import uuid

from datetime import datetime, timezone
from pathlib import Path

from database import save_recovery_manifest


MANIFEST_DIRECTORY = Path(__file__).resolve().parent / "manifests"


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
    verification_status: str
):
    MANIFEST_DIRECTORY.mkdir(
        parents=True,
        exist_ok=True
    )

    manifest_id = str(uuid.uuid4())

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
        "rto_seconds": rto_seconds,
        "verification_status": verification_status,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    manifest_path = (
        MANIFEST_DIRECTORY /
        f"recovery-{manifest_id}.json"
    )

    manifest_json = json.dumps(
        manifest,
        indent=4
    )

    # Save the portable JSON evidence file.
    manifest_path.write_text(
        manifest_json,
        encoding="utf-8"
    )

    # Save the same evidence in MySQL.
    save_recovery_manifest(
        manifest,
        str(manifest_path)
    )

    return {
        "manifest_id": manifest_id,
        "manifest_path": str(manifest_path),
        "manifest": manifest
    }
