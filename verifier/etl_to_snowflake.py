
import json
import os
from pathlib import Path

import mysql.connector
import snowflake.connector
from dotenv import load_dotenv

# -------------------------------------------------
# 1. LOAD PROJECT ENVIRONMENT VARIABLES
# -------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")


# -------------------------------------------------
# 2. MYSQL CONNECTION
# -------------------------------------------------

def get_mysql_connection():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3307")),
        database=os.getenv("MYSQL_DATABASE", "evidence_vault"),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD")
    )


# -------------------------------------------------
# 3. SNOWFLAKE CONNECTION
# -------------------------------------------------

def get_snowflake_connection():

    required = [
        "SNOWFLAKE_ACCOUNT",
        "SNOWFLAKE_USER",
        "SNOWFLAKE_PASSWORD",
        "SNOWFLAKE_WAREHOUSE",
        "SNOWFLAKE_DATABASE",
        "SNOWFLAKE_SCHEMA"
    ]

    missing = [
        key for key in required
        if not os.getenv(key)
    ]

    if missing:
        raise ValueError(
            "Missing Snowflake environment variables: "
            + ", ".join(missing)
        )

    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA"),
        autocommit=False
    )


# -------------------------------------------------
# 4. EXTRACT DATA FROM MYSQL
# -------------------------------------------------

def extract_mysql_data():

    connection = get_mysql_connection()

    queries = {
        "DR_DRILLS": """
            SELECT
                id,
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
                recovery_source,
                created_at
            FROM dr_drills
            ORDER BY id
        """,

        "DR_RECOVERY_MANIFESTS": """
            SELECT
                id,
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
                manifest_json,
                created_at
            FROM dr_recovery_manifests
            ORDER BY id
        """,

        "DR_METRICS": """
            SELECT
                id,
                document_id,
                failure_type,
                recovered_version_id,
                recovery_workflow_seconds,
                estimated_rpo_seconds,
                replication_status,
                replication_observation_seconds,
                created_at
            FROM dr_metrics
            ORDER BY id
        """
    }

    extracted = {}

    try:
        cursor = connection.cursor(dictionary=True)

        for table_name, query in queries.items():
            cursor.execute(query)
            extracted[table_name] = cursor.fetchall()

            print(
                f"Extracted {len(extracted[table_name])} "
                f"rows from MySQL table {table_name}"
            )

        return extracted

    finally:
        connection.close()


# -------------------------------------------------
# 5. PREPARE DATA FOR SNOWFLAKE
# -------------------------------------------------

def prepare_value(column, value):

    if column in (
        "primary_verified",
        "secondary_verified",
        "recovery_performed",
        "corruption_detected"
    ):
        return None if value is None else bool(value)

    if column == "manifest_json" and value is not None:

        if isinstance(value, (dict, list)):
            return json.dumps(value)

        if isinstance(value, bytes):
            return value.decode("utf-8")

        return str(value)

    return value


# -------------------------------------------------
# 6. LOAD DATA INTO SNOWFLAKE
# -------------------------------------------------

TABLE_COLUMNS = {
    "DR_DRILLS": [
        "id",
        "document_id",
        "primary_verified",
        "secondary_verified",
        "recovery_performed",
        "drill_status",
        "replication_lag_seconds",
        "rto_seconds",
        "expected_checksum",
        "primary_checksum",
        "secondary_checksum",
        "corruption_detected",
        "failure_type",
        "recovery_source",
        "created_at"
    ],

    "DR_RECOVERY_MANIFESTS": [
        "id",
        "manifest_id",
        "document_id",
        "failure_type",
        "source_region",
        "destination_region",
        "source_version_id",
        "recovered_version_id",
        "expected_checksum",
        "source_checksum",
        "recovered_checksum",
        "file_size_bytes",
        "rto_seconds",
        "verification_status",
        "manifest_path",
        "manifest_json",
        "created_at"
    ],

    "DR_METRICS": [
        "id",
        "document_id",
        "failure_type",
        "recovered_version_id",
        "recovery_workflow_seconds",
        "estimated_rpo_seconds",
        "replication_status",
        "replication_observation_seconds",
        "created_at"
    ]
}



def load_into_snowflake(extracted):

    connection = get_snowflake_connection()

    try:
        cursor = connection.cursor()

        cursor.execute("BEGIN")

        for table_name, columns in TABLE_COLUMNS.items():

            rows = extracted[table_name]

            cursor.execute(
                f"DELETE FROM {table_name}"
            )

            if not rows:
                print(f"No records available for {table_name}")
                continue

            column_sql = ", ".join(
                column.upper() for column in columns
            )

            value_sql = ", ".join(
                "PARSE_JSON(%s)"
                if column == "manifest_json"
                else "%s"
                for column in columns
            )

            insert_sql = f"""
                INSERT INTO {table_name} ({column_sql})
                SELECT {value_sql}
            """

            values = [
                tuple(
                    prepare_value(column, row.get(column))
                    for column in columns
                )
                for row in rows
            ]

            for row_values in values:
                cursor.execute(insert_sql, row_values)

            print(
                f"Loaded {len(values)} rows into "
                f"Snowflake table {table_name}"
            )

        connection.commit()

        print("\nSnowflake data load completed successfully.")

    except Exception:
        connection.rollback()
        print("Snowflake load failed. Transaction rolled back.")
        raise

    finally:
        connection.close()

# -------------------------------------------------
# 7. VERIFY SNOWFLAKE ROW COUNTS
# -------------------------------------------------

def verify_snowflake_data():

    connection = get_snowflake_connection()

    try:
        cursor = connection.cursor()

        print("\nSNOWFLAKE TABLE COUNTS")

        for table_name in TABLE_COLUMNS:

            cursor.execute(
                f"SELECT COUNT(*) FROM {table_name}"
            )

            count = cursor.fetchone()[0]

            print(f"{table_name}: {count} rows")

    finally:
        connection.close()


# -------------------------------------------------
# 8. MAIN ETL EXECUTION
# -------------------------------------------------

def main():

    print("Starting Document Evidence Vault ETL...\n")

    extracted = extract_mysql_data()

    load_into_snowflake(extracted)

    verify_snowflake_data()

    print("\nETL PROCESS FINISHED.")


if __name__ == "__main__":
    main()
