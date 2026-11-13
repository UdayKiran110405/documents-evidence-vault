import boto3
from botocore.exceptions import ProfileNotFound

from config import (
    AWS_PROFILE,
    PRIMARY_REGION,
    SECONDARY_REGION,
    PRIMARY_BUCKET,
    SECONDARY_BUCKET
)


def _build_session():
    if AWS_PROFILE:
        try:
            return boto3.Session(profile_name=AWS_PROFILE)
        except ProfileNotFound:
            pass
    return boto3.Session()


session = _build_session()

primary_s3 = session.client(
    "s3",
    region_name=PRIMARY_REGION
)

secondary_s3 = session.client(
    "s3",
    region_name=SECONDARY_REGION
)
primary_s3 = session.client(
    "s3",
    region_name=PRIMARY_REGION
)

secondary_s3 = session.client(
    "s3",
    region_name=SECONDARY_REGION
)

def get_s3_location(region: str):
    if region == "primary":
        return primary_s3, PRIMARY_BUCKET

    if region == "secondary":
        return secondary_s3, SECONDARY_BUCKET

    raise ValueError("Invalid S3 region")



def get_latest_data_version(s3, bucket: str, storage_key: str):
    """
    Return the current data version for an exact S3 key.

    If the latest S3 event is a delete marker, return None.
    Older retained versions remain untouched.
    """

    paginator = s3.get_paginator("list_object_versions")

    versions = []
    delete_markers = []

    for page in paginator.paginate(
        Bucket=bucket,
        Prefix=storage_key
    ):
        versions.extend(
            item for item in page.get("Versions", [])
            if item["Key"] == storage_key
        )

        delete_markers.extend(
            item for item in page.get("DeleteMarkers", [])
            if item["Key"] == storage_key
        )

    latest_version = next(
        (item for item in versions if item.get("IsLatest")),
        None
    )

    latest_delete_marker = next(
        (item for item in delete_markers if item.get("IsLatest")),
        None
    )

    if latest_delete_marker:
        return None

    if latest_version:
        return latest_version

    return None


def download_version(
    s3,
    bucket: str,
    key: str,
    version_id: str
):
    """
    Download one exact S3 object version.
    """

    response = s3.get_object(
        Bucket=bucket,
        Key=key,
        VersionId=version_id
    )

    body = response["Body"]

    try:
        return body.read()
    finally:
        body.close()


def upload_recovered_object(
    storage_key: str,
    content: bytes,
    filename: str,
    content_type: str
):
    """
    Upload recovered bytes to the Mumbai primary bucket.
    S3 versioning creates a new version; existing versions
    are not deleted.
    """

    response = primary_s3.put_object(
        Bucket=PRIMARY_BUCKET,
        Key=storage_key,
        Body=content,
        ContentType=content_type,
        Metadata={
            "original-filename": filename,
            "recovered-from": "secondary-region",
            "recovery-method": "verified-version-recovery"
        }
    )

    return response.get("VersionId")