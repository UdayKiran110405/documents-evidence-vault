
from database import get_document, save_recovery_version
from datetime import datetime, timezone
from s3_client import (
    secondary_s3,
    SECONDARY_BUCKET,
    download_version,
    get_latest_data_version,
    upload_recovered_object
)
from checksum import verify_checksum


def recover_document(document_id: int):

    document = get_document(document_id)

    if not document:
        raise ValueError("Document not found")

    storage_key = document["storage_key"]
    expected_checksum = document["sha256_checksum"]

    secondary_version = get_latest_data_version(
        secondary_s3,
        SECONDARY_BUCKET,
        storage_key
    )

    if secondary_version is None:
        raise ValueError("No secondary version is available")

    content = download_version(
        secondary_s3,
        SECONDARY_BUCKET,
        storage_key,
        secondary_version["VersionId"]
    )

    if not verify_checksum(content, expected_checksum):
        raise ValueError(
            "Secondary copy failed SHA-256 verification. "
            "Recovery stopped."
        )

    upload_started_at = datetime.now(timezone.utc)

    version_id = upload_recovered_object(
        storage_key,
        content,
        document["original_filename"],
        document["content_type"]
    )

    if not version_id:
        raise RuntimeError(
            "S3 did not return a version ID for the recovered object"
        )

    save_recovery_version(
        document_id=document_id,
        version_id=version_id,
        filename=document["original_filename"],
        content_type=document["content_type"],
        size=len(content),
        checksum=expected_checksum
    )

    return {
        "document_id": document_id,
        "recovery_status": "SUCCESS",
        "recovered_from": "Singapore",
        "recovered_to": "Mumbai",
        "new_primary_version_id": version_id,
        "file_size": len(content),
        "sha256_checksum": expected_checksum,
        "upload_started_at": upload_started_at.isoformat()
    }
