
import time
from datetime import datetime, timezone

from config import PRIMARY_BUCKET
from s3_client import primary_s3


def calculate_rto(start_time, end_time):
    """Duration of the application recovery workflow, in seconds."""
    return round((end_time - start_time).total_seconds(), 3)


def estimate_rpo_seconds(primary, secondary):
    """
    Timestamp-based recovery-point gap estimate.

    This is NOT measured data loss or a guaranteed RPO.
    Returns None when either version is unavailable.
    """
    if not primary or not secondary:
        return None

    if not primary.get("exists") or not secondary.get("exists"):
        return None

    primary_time = datetime.fromisoformat(primary["last_modified"])
    secondary_time = datetime.fromisoformat(secondary["last_modified"])

    return round(
        max(0.0, (primary_time - secondary_time).total_seconds()),
        3
    )


def track_replication(storage_key, version_id, upload_started_at,
                      timeout_seconds=30, interval_seconds=2):
    """
    Poll S3 for the replication status of one exact primary version.

    The measured duration is the elapsed time from the local
    upload-start timestamp to our first observation of COMPLETED.

    It includes upload time and polling delay, so it is not
    the exact internal AWS replication duration.
    """
    deadline = time.monotonic() + timeout_seconds

    while True:
        response = primary_s3.head_object(
            Bucket=PRIMARY_BUCKET,
            Key=storage_key,
            VersionId=version_id
        )

        status = response.get("ReplicationStatus", "NOT_AVAILABLE")

        if status in ("COMPLETED", "FAILED"):
            observed_at = datetime.now(timezone.utc)

            return {
                "replication_status": status,
                "replication_observation_seconds": round(
                    (observed_at - upload_started_at).total_seconds(),
                    3
                ),
                "observation_completed_at": observed_at.isoformat()
            }

        if status == "NOT_AVAILABLE":
            return {
                "replication_status": status,
                "replication_observation_seconds": None,
                "observation_completed_at": None
            }

        if time.monotonic() >= deadline:
            return {
                "replication_status": status,
                "replication_observation_seconds": None,
                "observation_completed_at": None
            }

        time.sleep(interval_seconds)
