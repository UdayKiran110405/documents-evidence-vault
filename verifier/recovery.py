
import time
from datetime import datetime, timezone

from botocore.exceptions import ClientError

from database import (
    get_document,
    get_document_version,
    get_latest_document_version,
    save_recovery_version
)

from s3_client import (
    primary_s3,
    secondary_s3,
    PRIMARY_BUCKET,
    SECONDARY_BUCKET,
    download_version,
    upload_recovered_object
)

from checksum import calculate_sha256


def _is_missing_version(error: ClientError) -> bool:
    error_code = str(
        error.response.get("Error", {}).get("Code", "")
    )

    status_code = error.response.get(
        "ResponseMetadata", {}
    ).get("HTTPStatusCode")

    return (
        error_code in {
            "NoSuchKey",
            "NoSuchVersion",
            "NotFound",
            "404"
        }
        or status_code == 404
    )


def _verify_s3_version(
    s3,
    bucket: str,
    storage_key: str,
    version_id: str,
    expected_checksum: str,
    expected_size: int,
    region_name: str
):
    """
    Read back and verify one exact S3 object version.
    """

    try:
        head = s3.head_object(
            Bucket=bucket,
            Key=storage_key,
            VersionId=version_id
        )

        content = download_version(
            s3,
            bucket,
            storage_key,
            version_id
        )

    except ClientError as error:
        if _is_missing_version(error):
            raise ValueError(
                f"Version {version_id} does not exist in "
                f"{region_name}"
            ) from error

        raise RuntimeError(
            f"Could not access the S3 version in {region_name}: "
            f"{error.response.get('Error', {}).get('Code', 'Unknown')}"
        ) from error

    actual_checksum = calculate_sha256(content)
    actual_size = len(content)

    version_matches = (
        head.get("VersionId") == version_id
    )

    checksum_matches = (
        actual_checksum.lower()
        == expected_checksum.lower()
    )

    size_matches = (
        actual_size == expected_size
    )

    return {
        "region": region_name,
        "exists": True,
        "version_id": head.get("VersionId"),
        "version_matches": version_matches,
        "expected_checksum": expected_checksum,
        "actual_checksum": actual_checksum,
        "checksum_verified": checksum_matches,
        "expected_size_bytes": expected_size,
        "actual_size_bytes": actual_size,
        "size_verified": size_matches,
        "verified": (
            version_matches
            and checksum_matches
            and size_matches
        )
    }


def recover_document(
    document_id: int,
    version_id: str = None
):
    """
    Recover a database-recorded document version from Singapore
    into Mumbai.

    MySQL is updated only after the destination S3 version has
    passed checksum, size and version-ID verification.

    If S3 upload succeeds but verification or the database update
    fails, the S3 version is intentionally retained for
    reconciliation. It is not automatically deleted.
    """

    recovery_started_at = datetime.now(timezone.utc)
    monotonic_started_at = time.perf_counter()

    document = get_document(document_id)

    if not document:
        raise ValueError("Document not found")

    if version_id:
        selected_version = get_document_version(
            document_id,
            version_id
        )
    else:
        selected_version = get_latest_document_version(
            document_id
        )

    if not selected_version:
        raise ValueError(
            "The requested version does not exist in database history"
        )

    source_version_id = selected_version.get(
        "s3_version_id"
    )

    expected_checksum = selected_version.get(
        "sha256_checksum"
    )

    expected_size = selected_version.get(
        "file_size_bytes"
    )

    filename = selected_version.get(
        "original_filename"
    )

    content_type = selected_version.get(
        "content_type"
    )

    if not source_version_id:
        raise ValueError(
            "Selected database version has no S3 version ID"
        )

    if not expected_checksum:
        raise ValueError(
            "Selected database version has no SHA-256 checksum"
        )

    if expected_size is None:
        raise ValueError(
            "Selected database version has no recorded file size"
        )

    if not filename or not content_type:
        raise ValueError(
            "Selected database version is missing file metadata"
        )

    storage_key = document["storage_key"]

    # -------------------------------------------------
    # STEP 1: Verify the exact source version in Singapore.
    # -------------------------------------------------

    source_verification = _verify_s3_version(
        s3=secondary_s3,
        bucket=SECONDARY_BUCKET,
        storage_key=storage_key,
        version_id=source_version_id,
        expected_checksum=expected_checksum,
        expected_size=expected_size,
        region_name="Singapore"
    )

    if not source_verification["verified"]:
        raise ValueError(
            "Singapore source version failed integrity verification. "
            "Recovery stopped before uploading to Mumbai."
        )

    # -------------------------------------------------
    # STEP 2: Download the verified source version.
    # -------------------------------------------------

    content = download_version(
        secondary_s3,
        SECONDARY_BUCKET,
        storage_key,
        source_version_id
    )

    # Recalculate immediately before upload.
    source_checksum = calculate_sha256(content)

    if source_checksum.lower() != expected_checksum.lower():
        raise ValueError(
            "Downloaded Singapore content failed SHA-256 verification"
        )

    # -------------------------------------------------
    # STEP 3: Upload to Mumbai.
    # -------------------------------------------------

    upload_started_at = datetime.now(timezone.utc)

    new_primary_version_id = upload_recovered_object(
        storage_key,
        content,
        filename,
        content_type
    )

    if not new_primary_version_id:
        raise RuntimeError(
            "Mumbai S3 did not return a version ID. "
            "Database was not updated."
        )

    # -------------------------------------------------
    # STEP 4: Read back the exact destination version.
    # -------------------------------------------------

    destination_verification = _verify_s3_version(
        s3=primary_s3,
        bucket=PRIMARY_BUCKET,
        storage_key=storage_key,
        version_id=new_primary_version_id,
        expected_checksum=expected_checksum,
        expected_size=expected_size,
        region_name="Mumbai"
    )

    if not destination_verification["verified"]:
        raise RuntimeError(
            "Mumbai upload exists but failed read-back verification. "
            f"Uncommitted S3 version: {new_primary_version_id}. "
            "Database was not updated; reconciliation is required."
        )

    # -------------------------------------------------
    # STEP 5: Update MySQL only after destination verification.
    # -------------------------------------------------

    try:
        save_recovery_version(
            document_id=document_id,
            version_id=new_primary_version_id,
            filename=filename,
            content_type=content_type,
            size=len(content),
            checksum=expected_checksum
        )

    except Exception as error:
        raise RuntimeError(
            "S3 recovery upload and destination verification succeeded, "
            "but the MySQL update failed. "
            f"Uncommitted S3 version: {new_primary_version_id}. "
            "Do not repeat recovery blindly; reconcile S3 and MySQL first."
        ) from error

    # -------------------------------------------------
    # STEP 6: Return an auditable recovery result.
    # -------------------------------------------------

    recovery_completed_at = datetime.now(timezone.utc)

    recovery_duration_seconds = round(
        time.perf_counter() - monotonic_started_at,
        3
    )

    return {
        "document_id": document_id,
        "recovery_status": "SUCCESS",
        "source_region": "ap-southeast-1",
        "destination_region": "ap-south-1",
        "selected_source_version_id": source_version_id,
        "new_primary_version_id": new_primary_version_id,
        "source_verified": source_verification["verified"],
        "destination_verified": destination_verification["verified"],
        "database_updated": True,
        "expected_checksum": expected_checksum,
        "source_checksum": source_verification["actual_checksum"],
        "recovered_checksum": destination_verification["actual_checksum"],
        "file_size_bytes": len(content),
        "recovery_started_at": recovery_started_at.isoformat(),
        "upload_started_at": upload_started_at.isoformat(),
        "recovery_completed_at": recovery_completed_at.isoformat(),
        "recovery_duration_seconds": recovery_duration_seconds
    }
