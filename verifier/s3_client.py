
import boto3

from config import (
    AWS_PROFILE,
    PRIMARY_REGION,
    SECONDARY_REGION,
    PRIMARY_BUCKET,
    SECONDARY_BUCKET
)

session = boto3.Session(profile_name=AWS_PROFILE)

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
    response = s3.list_object_versions(
        Bucket=bucket,
        Prefix=storage_key
    )

    versions = [
        item for item in response.get("Versions", [])
        if item["Key"] == storage_key
    ]

    if not versions:
        return None

    versions.sort(
        key=lambda item: item["LastModified"],
        reverse=True
    )

    return versions[0]


def download_version(s3, bucket: str, key: str, version_id: str):
    response = s3.get_object(
        Bucket=bucket,
        Key=key,
        VersionId=version_id
    )

    return response["Body"].read()


def upload_recovered_object(
    storage_key: str,
    content: bytes,
    filename: str,
    content_type: str
):
    response = primary_s3.put_object(
        Bucket=PRIMARY_BUCKET,
        Key=storage_key,
        Body=content,
        ContentType=content_type,
        Metadata={
            "original-filename": filename,
            "recovered-from": "secondary-region"
        }
    )

    return response.get("VersionId")
