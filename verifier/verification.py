
from database import get_document
from s3_client import (
    get_s3_location,
    get_latest_data_version,
    download_version
)
from checksum import calculate_sha256, verify_checksum


def verify_region(storage_key: str, expected_checksum: str, region: str):

    s3, bucket = get_s3_location(region)

    version = get_latest_data_version(
        s3,
        bucket,
        storage_key
    )

    if version is None:
        return {
            "region": region,
            "exists": False,
            "verified": False,
            "version_id": None,
            "actual_checksum": None
        }

    content = download_version(
        s3,
        bucket,
        storage_key,
        version["VersionId"]
    )

    actual_checksum = calculate_sha256(content)

    return {
        "region": region,
        "exists": True,
        "verified": verify_checksum(
            content,
            expected_checksum
        ),
        "version_id": version["VersionId"],
        "size_bytes": len(content),
        "actual_checksum": actual_checksum,
        "last_modified": version["LastModified"].isoformat()
    }


def verify_document(document_id: int):

    document = get_document(document_id)

    if not document:
        raise ValueError("Document not found")

    if document["status"] != "ACTIVE":
        raise ValueError(
            f"Document status is {document['status']}; "
            "only ACTIVE documents can be verified"
        )

    primary = verify_region(
        document["storage_key"],
        document["sha256_checksum"],
        "primary"
    )

    secondary = verify_region(
        document["storage_key"],
        document["sha256_checksum"],
        "secondary"
    )

    return {
        "document_id": document_id,
        "filename": document["original_filename"],
        "expected_checksum": document["sha256_checksum"],
        "primary": primary,
        "secondary": secondary,
        "overall_verified": (
            primary["verified"] and secondary["verified"]
        )
    }
