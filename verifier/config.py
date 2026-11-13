import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_ROOT / ".env")

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3307"))
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "evidence_vault")
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")

AWS_PROFILE = os.getenv("AWS_PROFILE", "").strip() or None

PRIMARY_REGION = os.getenv("PRIMARY_REGION", "ap-south-1")
SECONDARY_REGION = os.getenv("SECONDARY_REGION", "ap-southeast-1")

PRIMARY_BUCKET = os.getenv("PRIMARY_BUCKET", "evidence-vault-primary-263554")
SECONDARY_BUCKET = os.getenv("SECONDARY_BUCKET", "evidence-vault-secondary-263554")

PYTHON_SERVICE_TOKEN = os.getenv(
    "PYTHON_SERVICE_TOKEN",
    ""
).strip()