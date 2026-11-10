
from database import get_document
from s3_client import (
    get_s3_location,
    get_latest_data_version,
    download_version
)
from checksum import calculate_sha256, verify_checksum


def simulate_primary_corruption(document_id: int):

    document = get_document(document_id)

    if not document:
        raise ValueError("Document not found")

    if document["status"] != "ACTIVE":
        raise ValueError("Only ACTIVE documents can be tested")

    storage_key = document["storage_key"]
    expected_checksum = document["sha256_checksum"]

    # Obtain the actual primary object.
    primary_s3, primary_bucket = get_s3_location("primary")

    version = get_latest_data_version(
        primary_s3,
        primary_bucket,
        storage_key
    )

    if version is None:
        raise ValueError("No primary object version found")

    original_content = download_version(
        primary_s3,
        primary_bucket,
        storage_key,
        version["VersionId"]
    )

    # Simulate corruption in memory only.
    corrupted_content = bytearray(original_content)

    if corrupted_content:
        position = len(corrupted_content) // 2
        corrupted_content[position] ^= 0x01
    else:
        corrupted_content.extend(b"CORRUPTED")

    corrupted_content = bytes(corrupted_content)

    corrupted_checksum = calculate_sha256(
        corrupted_content
    )

    corruption_detected = not verify_checksum(
        corrupted_content,
        expected_checksum
    )

    return {
        "document_id": document_id,
        "storage_key": storage_key,
        "original_version_id": version["VersionId"],
        "expected_checksum": expected_checksum,
        "original_checksum": calculate_sha256(original_content),
        "corrupted_checksum": corrupted_checksum,
        "original_size": len(original_content),
        "corrupted_size": len(corrupted_content),
        "corruption_detected": corruption_detected,
        "actual_s3_object_modified": False
    }
