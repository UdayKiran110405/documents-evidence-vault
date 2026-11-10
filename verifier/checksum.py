
import hashlib


def calculate_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def verify_checksum(content: bytes, expected_checksum: str) -> bool:
    actual_checksum = calculate_sha256(content)

    return actual_checksum.lower() == expected_checksum.lower()
