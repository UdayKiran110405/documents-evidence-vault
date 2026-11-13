
import mysql.connector
import json

from config import (
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD
)


def get_connection():
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=MYSQL_DATABASE,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD
    )


def get_document(document_id: int):
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                id,
                original_filename,
                storage_key,
                content_type,
                file_size_bytes,
                sha256_checksum,
                status
            FROM documents
            WHERE id = %s
            """,
            (document_id,)
        )

        return cursor.fetchone()

    finally:
        connection.close()

def get_document_version(document_id: int, version_id: str):
    """
    Retrieve one exact version belonging to a document.
    The version ID must match a row in document_versions.
    """
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                id,
                document_id,
                s3_version_id,
                original_filename,
                content_type,
                file_size_bytes,
                sha256_checksum,
                created_at
            FROM document_versions
            WHERE document_id = %s
              AND s3_version_id = %s
            LIMIT 1
            """,
            (document_id, version_id)
        )

        return cursor.fetchone()

    finally:
        connection.close()


def get_latest_document_version(document_id: int):
    """
    Retrieve the most recently inserted version for a document.

    Auto-incrementing ID is used as the ordering source because
    created_at may contain timestamps written in different time zones.
    """
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                id,
                document_id,
                s3_version_id,
                original_filename,
                content_type,
                file_size_bytes,
                sha256_checksum,
                created_at
            FROM document_versions
            WHERE document_id = %s
            ORDER BY id DESC
            LIMIT 1
            """,
            (document_id,)
        )

        return cursor.fetchone()

    finally:
        connection.close()


def save_recovery_version(
    document_id: int,
    version_id: str,
    filename: str,
    content_type: str,
    size: int,
    checksum: str
):
    """
    Atomically record a recovered S3 version and update document metadata.

    The document row is locked before inserting the version.
    Timestamps are written in UTC.
    """
    connection = get_connection()
    cursor = None

    try:
        connection.start_transaction()
        cursor = connection.cursor()

        # Confirm the document exists and lock it during this transaction.
        cursor.execute(
            """
            SELECT id
            FROM documents
            WHERE id = %s
            FOR UPDATE
            """,
            (document_id,)
        )

        document = cursor.fetchone()

        if document is None:
            raise ValueError(
                f"Document {document_id} does not exist."
            )

        # Record the exact S3 version that was recovered.
        cursor.execute(
            """
            INSERT INTO document_versions (
                document_id,
                s3_version_id,
                original_filename,
                content_type,
                file_size_bytes,
                sha256_checksum,
                created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP())
            """,
            (
                document_id,
                version_id,
                filename,
                content_type,
                size,
                checksum
            )
        )

        # Update the current document metadata.
        cursor.execute(
            """
            UPDATE documents
            SET original_filename = %s,
                content_type = %s,
                file_size_bytes = %s,
                sha256_checksum = %s,
                status = 'ACTIVE',
                delete_marker_version_id = NULL
            WHERE id = %s
            """,
            (
                filename,
                content_type,
                size,
                checksum,
                document_id
            )
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        if cursor is not None:
            cursor.close()

        connection.close()


def create_drill_table():
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS dr_drills (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                document_id BIGINT NOT NULL,
                primary_verified BOOLEAN NOT NULL,
                secondary_verified BOOLEAN NOT NULL,
                recovery_performed BOOLEAN NOT NULL,
                drill_status VARCHAR(30) NOT NULL,
                replication_lag_seconds DOUBLE NULL,
                rto_seconds DOUBLE NOT NULL,
                expected_checksum VARCHAR(64) NOT NULL,
                primary_checksum VARCHAR(64) NULL,
                secondary_checksum VARCHAR(64) NULL,
                corruption_detected BOOLEAN NOT NULL DEFAULT FALSE,
                failure_type VARCHAR(40) NOT NULL DEFAULT 'NONE',
                recovery_source VARCHAR(30) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Safely migrate an existing table.
        cursor.execute(
            """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'dr_drills'
            """
        )

        existing_columns = {
            row[0] for row in cursor.fetchall()
        }

        migrations = {
            "corruption_detected":
                "ALTER TABLE dr_drills ADD COLUMN corruption_detected BOOLEAN NOT NULL DEFAULT FALSE",

            "failure_type":
                "ALTER TABLE dr_drills ADD COLUMN failure_type VARCHAR(40) NOT NULL DEFAULT 'NONE'",

            "recovery_source":
                "ALTER TABLE dr_drills ADD COLUMN recovery_source VARCHAR(30) NULL"
        }

        for column, sql in migrations.items():
            if column not in existing_columns:
                cursor.execute(sql)

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def save_drill_result(result: dict):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO dr_drills (
                document_id,
                primary_verified,
                secondary_verified,
                recovery_performed,
                drill_status,
                replication_lag_seconds,
                rto_seconds,
                expected_checksum,
                primary_checksum,
                secondary_checksum,
                corruption_detected,
                failure_type,
                recovery_source
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s
            )
            """,
            (
                result["document_id"],
                result["primary_verified"],
                result["secondary_verified"],
                result["recovery_performed"],
                result["drill_status"],
                result["replication_lag_seconds"],
                result["rto_seconds"],
                result["expected_checksum"],
                result["primary_checksum"],
                result["secondary_checksum"],
                result.get("corruption_detected", False),
                result.get("failure_type", "NONE"),
                result.get("recovery_source")
            )
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def get_drill_history():
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT *
            FROM dr_drills
            ORDER BY id DESC
            LIMIT 100
            """
        )

        return cursor.fetchall()

    finally:
        connection.close()


def create_manifest_table():
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS dr_recovery_manifests (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                manifest_id VARCHAR(36) NOT NULL UNIQUE,
                document_id BIGINT NOT NULL,
                failure_type VARCHAR(50) NOT NULL,
                source_region VARCHAR(50) NOT NULL,
                destination_region VARCHAR(50) NOT NULL,
                source_version_id VARCHAR(255) NOT NULL,
                recovered_version_id VARCHAR(255) NOT NULL,
                expected_checksum VARCHAR(64) NOT NULL,
                source_checksum VARCHAR(64) NOT NULL,
                recovered_checksum VARCHAR(64) NOT NULL,
                file_size_bytes BIGINT NOT NULL,
                rto_seconds DOUBLE NOT NULL,
                verification_status VARCHAR(30) NOT NULL,
                manifest_path VARCHAR(500) NOT NULL,
                manifest_json JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def save_recovery_manifest(manifest: dict, manifest_path: str):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO dr_recovery_manifests (
                manifest_id,
                document_id,
                failure_type,
                source_region,
                destination_region,
                source_version_id,
                recovered_version_id,
                expected_checksum,
                source_checksum,
                recovered_checksum,
                file_size_bytes,
                rto_seconds,
                verification_status,
                manifest_path,
                manifest_json
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s
            )
            """,
            (
                manifest["manifest_id"],
                manifest["document_id"],
                manifest["failure_type"],
                manifest["source_region"],
                manifest["destination_region"],
                manifest["source_version_id"],
                manifest["recovered_version_id"],
                manifest["expected_checksum"],
                manifest["source_checksum"],
                manifest["recovered_checksum"],
                manifest["file_size_bytes"],
                manifest["rto_seconds"],
                manifest["verification_status"],
                manifest_path,
                json.dumps(manifest)
            )
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def get_recovery_manifests():
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                id,
                manifest_id,
                document_id,
                failure_type,
                source_region,
                destination_region,
                recovered_version_id,
                verification_status,
                rto_seconds,
                manifest_path,
                created_at
            FROM dr_recovery_manifests
            ORDER BY created_at DESC
            LIMIT 100
            """
        )

        return cursor.fetchall()

    finally:
        connection.close()



def create_metrics_table():
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS dr_metrics (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                document_id BIGINT NOT NULL,
                failure_type VARCHAR(50) NOT NULL,
                recovered_version_id VARCHAR(255) NOT NULL,
                recovery_workflow_seconds DOUBLE NOT NULL,
                estimated_rpo_seconds DOUBLE NULL,
                replication_status VARCHAR(30) NOT NULL,
                replication_observation_seconds DOUBLE NULL,
                recovery_rto_seconds DOUBLE NULL,
                drill_duration_seconds DOUBLE NULL,
                replication_timed_out BOOLEAN NOT NULL DEFAULT FALSE,
                replication_error_code VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'dr_metrics'
        """)

        existing_columns = {
            row[0] for row in cursor.fetchall()
        }

        migrations = {
            "recovery_rto_seconds":
                "ALTER TABLE dr_metrics ADD COLUMN recovery_rto_seconds DOUBLE NULL",

            "drill_duration_seconds":
                "ALTER TABLE dr_metrics ADD COLUMN drill_duration_seconds DOUBLE NULL",

            "replication_timed_out":
                "ALTER TABLE dr_metrics ADD COLUMN replication_timed_out BOOLEAN NOT NULL DEFAULT FALSE",

            "replication_error_code":
                "ALTER TABLE dr_metrics ADD COLUMN replication_error_code VARCHAR(100) NULL"
        }

        for column, sql in migrations.items():
            if column not in existing_columns:
                cursor.execute(sql)

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def save_dr_metrics(metrics):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        recovery_rto = metrics.get(
            "recovery_rto_seconds",
            metrics["recovery_workflow_seconds"]
        )

        cursor.execute("""
            INSERT INTO dr_metrics (
                document_id,
                failure_type,
                recovered_version_id,
                recovery_workflow_seconds,
                estimated_rpo_seconds,
                replication_status,
                replication_observation_seconds,
                recovery_rto_seconds,
                drill_duration_seconds,
                replication_timed_out,
                replication_error_code
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """, (
            metrics["document_id"],
            metrics["failure_type"],
            metrics["recovered_version_id"],
            recovery_rto,
            metrics.get("estimated_rpo_seconds"),
            metrics["replication_status"],
            metrics.get("replication_observation_seconds"),
            recovery_rto,
            metrics.get("drill_duration_seconds"),
            metrics.get("replication_timed_out", False),
            metrics.get("replication_error_code")
        ))

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

def get_dr_metrics():
    connection = get_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT *
            FROM dr_metrics
            ORDER BY id DESC
            LIMIT 100
        """)

        return cursor.fetchall()

    finally:
        connection.close()
def get_all_active_documents():
    connection = get_connection()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT
                d.id,
                d.original_filename,
                d.storage_key,
                d.category,
                d.file_size_bytes,
                d.sha256_checksum,
                d.status,
                d.created_at,
                (
                    SELECT dv.s3_version_id
                    FROM document_versions dv
                    WHERE dv.document_id = d.id
                    ORDER BY dv.id DESC
                    LIMIT 1
                ) AS latest_s3_version_id
            FROM documents d
            WHERE d.status IN ('ACTIVE', 'CORRUPTED')
            ORDER BY d.id DESC
            LIMIT 100
            """
        )
        return cursor.fetchall()
    finally:
        connection.close()

