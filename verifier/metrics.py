
import time
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError

from config import PRIMARY_BUCKET
from s3_client import primary_s3


def calculate_rto(start_time: datetime, end_time: datetime) -> float:
    """Calculate elapsed recovery time in seconds."""

    if (
        start_time.tzinfo is None
        or start_time.utcoffset() is None
        or end_time.tzinfo is None
        or end_time.utcoffset() is None
    ):
        raise ValueError("RTO timestamps must be timezone-aware")

    return round(
        max(0.0, (end_time - start_time).total_seconds()),
        3
    )


def _parse_aware_timestamp(value):
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )

        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None

        return parsed.astimezone(timezone.utc)

    except (TypeError, ValueError):
        return None


def estimate_rpo_seconds(primary, secondary):
    """
    Estimate how far the primary copy's timestamp is ahead
    of the secondary copy.

    This is an observational timestamp estimate, not measured
    data loss or a guaranteed RPO.
    """

    if not primary or not secondary:
        return None

    if not primary.get("exists") or not secondary.get("exists"):
        return None

    primary_time = _parse_aware_timestamp(
        primary.get("last_modified")
    )

    secondary_time = _parse_aware_timestamp(
        secondary.get("last_modified")
    )

    if primary_time is None or secondary_time is None:
        return None

    return round(
        max(
            0.0,
            (primary_time - secondary_time).total_seconds()
        ),
        3
    )


def track_replication(
    storage_key: str,
    version_id: str,
    upload_started_at: datetime,
    timeout_seconds: int = 60,
    interval_seconds: int = 2
):
    """
    Observe replication status for one exact primary S3 version.

    The elapsed observation includes upload time and polling delay.
    It is not AWS's internal replication processing duration.
    """

    if not storage_key or not version_id:
        raise ValueError("Storage key and version ID are required")

    if timeout_seconds < 0 or interval_seconds <= 0:
        raise ValueError("Invalid replication polling configuration")

    if (
        upload_started_at.tzinfo is None
        or upload_started_at.utcoffset() is None
    ):
        raise ValueError("upload_started_at must be timezone-aware")

    deadline = time.monotonic() + timeout_seconds

    while True:
        observed_at = datetime.now(timezone.utc)

        try:
            response = primary_s3.head_object(
                Bucket=PRIMARY_BUCKET,
                Key=storage_key,
                VersionId=version_id
            )

        except (ClientError, BotoCoreError) as error:
            error_code = "AWS_CLIENT_ERROR"

            if isinstance(error, ClientError):
                error_code = error.response.get(
                    "Error", {}
                ).get("Code", error_code)

            return {
                "replication_status": "ERROR",
                "replication_observation_seconds": None,
                "observation_completed_at": observed_at.isoformat(),
                "timed_out": False,
                "error_code": error_code
            }

        status = response.get(
            "ReplicationStatus",
            "NOT_AVAILABLE"
        )

        if status in ("COMPLETED", "FAILED"):
            return {
                "replication_status": status,
                "replication_observation_seconds": round(
                    max(
                        0.0,
                        (
                            observed_at - upload_started_at
                        ).total_seconds()
                    ),
                    3
                ),
                "observation_completed_at": observed_at.isoformat(),
                "timed_out": False,
                "error_code": None
            }

        if status == "NOT_AVAILABLE":
            return {
                "replication_status": status,
                "replication_observation_seconds": None,
                "observation_completed_at": observed_at.isoformat(),
                "timed_out": False,
                "error_code": None
            }

        if time.monotonic() >= deadline:
            return {
                "replication_status": status,
                "replication_observation_seconds": None,
                "observation_completed_at": observed_at.isoformat(),
                "timed_out": True,
                "error_code": None
            }

        time.sleep(interval_seconds)
