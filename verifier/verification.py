
from botocore.exceptions import ClientError

from database import (
    get_document,
    get_latest_document_version
)

from s3_client import (
    get_s3_location,
    download_version
)

from checksum import calculate_sha256


def _is_missing_version_error(error: ClientError) -> bool:
    """
    Return True only when S3 confirms that the requested
    object/version does not exist.

    AccessDenied and other infrastructure errors must not
    be incorrectly reported as missing objects.
    """
    error_code = str(
        error.response.get("Error", {}).get("Code", "")
    )

    http_status = error.response.get(
        "ResponseMetadata", {}
    ).get("HTTPStatusCode")

    return (
        error_code in {
            "NoSuchKey",
            "NoSuchVersion",
            "NotFound",
            "404"
        }
        or http_status == 404
    )


def verify_region(
    storage_key: str,
    expected_checksum: str,
    expected_size: int,
    version_id: str,
    region: str
):
    """
    Verify one exact S3 object version in one region.

    Checks:
    - Object version exists.
    - Returned version ID matches the requested version.
    - Actual file size matches database metadata.
    - Actual SHA-256 matches database metadata.
    """

    s3, bucket = get_s3_location(region)

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
        if _is_missing_version_error(error):
            return {
                "region": region,
                "exists": False,
                "verified": False,
                "version_id": version_id,
                "version_matches": False,
                "size_bytes": None,
                "size_verified": False,
                "actual_checksum": None,
                "checksum_verified": False,
                "last_modified": None,
                "error": "Requested S3 version does not exist"
            }

        raise RuntimeError(
            f"S3 verification failed in {region}: "
            f"{error.response.get('Error', {}).get('Code', 'Unknown')}"
        ) from error

    returned_version_id = head.get("VersionId")

    version_matches = (
        returned_version_id == version_id
    )

    actual_size = len(content)

    size_verified = (
        actual_size == expected_size
    )

    actual_checksum = calculate_sha256(content)

    checksum_verified = (
        actual_checksum.lower()
        == expected_checksum.lower()
    )

    verified = (
        version_matches
        and size_verified
        and checksum_verified
    )

    last_modified = head.get("LastModified")

    return {
        "region": region,
        "exists": True,
        "verified": verified,
        "version_id": returned_version_id,
        "version_matches": version_matches,
        "size_bytes": actual_size,
        "expected_size_bytes": expected_size,
        "size_verified": size_verified,
        "actual_checksum": actual_checksum,
        "expected_checksum": expected_checksum,
        "checksum_verified": checksum_verified,
        "last_modified": (
            last_modified.isoformat()
            if last_modified else None
        )
    }


def verify_document(document_id: int):
    """
    Verify the latest database-recorded version of a document
    in both configured S3 regions.

    Both regions are checked against the same exact version ID.
    """

    document = get_document(document_id)

    if not document:
        raise ValueError("Document not found")

    if document["status"] not in ("ACTIVE", "CORRUPTED"):
        raise ValueError(
            f"Document status is {document['status']}; "
            "only ACTIVE or CORRUPTED documents can be verified"
        )

    selected_version = get_latest_document_version(
        document_id
    )

    if not selected_version:
        raise ValueError(
            "No database version history exists for this document"
        )

    version_id = selected_version.get("s3_version_id")
    expected_checksum = selected_version.get(
        "sha256_checksum"
    )
    expected_size = selected_version.get(
        "file_size_bytes"
    )

    if not version_id:
        raise ValueError(
            "The selected database version has no S3 version ID"
        )

    if not expected_checksum:
        raise ValueError(
            "The selected database version has no SHA-256 checksum"
        )

    if expected_size is None:
        raise ValueError(
            "The selected database version has no recorded file size"
        )

    # Verify the same exact version in Mumbai.
    primary = verify_region(
        storage_key=document["storage_key"],
        expected_checksum=expected_checksum,
        expected_size=expected_size,
        version_id=version_id,
        region="primary"
    )

    # Verify the same exact version in Singapore.
    secondary = verify_region(
        storage_key=document["storage_key"],
        expected_checksum=expected_checksum,
        expected_size=expected_size,
        version_id=version_id,
        region="secondary"
    )

    return {
        "document_id": document_id,
        "filename": selected_version["original_filename"],
        "expected_version_id": version_id,
        "expected_checksum": expected_checksum,
        "expected_size_bytes": expected_size,
        "primary": primary,
        "secondary": secondary,
        "overall_verified": (
            primary["verified"]
            and secondary["verified"]
        )
    }
