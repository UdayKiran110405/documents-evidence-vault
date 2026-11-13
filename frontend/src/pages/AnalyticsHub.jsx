import { useState } from "react";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Info,
  Table2,
} from "lucide-react";

import { syncToSnowflakeWarehouse } from "../services/recoveryService";

import "../styles/documents.css";

const WAREHOUSE_TABLES = [
  {
    name: "DOCUMENTS",
    desc: "Active, soft-deleted, and corrupted vault inventory with SHA-256 hashes.",
  },
  {
    name: "AUDIT_LOGS",
    desc: "Complete user access, upload, integrity failure, and restore audit trail.",
  },
  {
    name: "DR_DRILLS",
    desc: "Outcomes of automated, primary outage, and byte corruption drills.",
  },
  {
    name: "DR_RECOVERY_MANIFESTS",
    desc: "Signed cryptographic proof records linking source & recovered S3 versions.",
  },
  {
    name: "DR_METRICS",
    desc: "Measured RTO downtime, estimated RPO lag, and CRR observation timings.",
  },
];

export default function AnalyticsHub() {
  const [syncing, setSyncing] = useState(false);
  const [syncData, setSyncData] = useState(null);
  const [error, setError] = useState("");

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      const res = await syncToSnowflakeWarehouse();
      setSyncData(res);
    } catch (err) {
      setError(err?.message || "Snowflake ETL sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">
            ENTERPRISE COMPLIANCE ANALYTICS
          </span>
          <h1>Snowflake &amp; Power BI Hub</h1>
          <p>
            Push transactional MySQL/RDS compliance records into Snowflake (
            <code>EVIDENCE_VAULT_ANALYTICS.DR</code>) for Power BI dashboards.
          </p>
        </div>

        <button
          className="document-primary-button"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw size={16} className={syncing ? "documents-spin" : ""} />
          {syncing ? "Running ETL Pipeline..." : "Sync All Tables to Snowflake"}
        </button>
      </section>

      <div className="explainer-banner">
        <Info size={20} />
        <div>
          <strong>How Analytics Reporting Works:</strong> Clicking{" "}
          <strong>Sync All Tables to Snowflake</strong> runs{" "}
          <code>etl_to_snowflake.py</code> inside the Python Verifier, loading
          all 5 operational &amp; DR tables atomically into Snowflake so Power
          BI Desktop can refresh SLA charts and audit reports.
        </div>
      </div>

      {syncData && (
        <div className="document-alert document-alert-success">
          <CheckCircle2 size={18} />
          <span>
            Warehouse Synced Successfully at{" "}
            {new Date(syncData.timestamp).toLocaleTimeString()} —{" "}
            <strong>{syncData.total_rows_synced} total rows</strong> committed
            across 5 Snowflake tables.
          </span>
        </div>
      )}

      {error && (
        <div className="document-alert document-alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="evidence-cards-grid">
        {WAREHOUSE_TABLES.map((tbl) => {
          const rowCount = syncData?.synced_tables?.[tbl.name];
          return (
            <article key={tbl.name} className="evidence-card">
              <div className="evidence-card-top">
                <div className="document-file-icon">
                  <Table2 size={19} />
                </div>
                <div className="evidence-card-title">
                  <span className="evidence-id-tag">SNOWFLAKE TABLE</span>
                  <h3>{tbl.name}</h3>
                </div>
                {rowCount !== undefined && (
                  <span className="document-status document-status-active">
                    {rowCount} ROWS
                  </span>
                )}
              </div>
              <p className="evidence-card-desc">{tbl.desc}</p>
            </article>
          );
        })}
      </section>

      <section className="documents-table-card" style={{ padding: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <BarChart3 size={20} color="var(--accent)" />
          <h2 style={{ fontSize: 16 }}>
            Power BI Executive Report Connection Guide
          </h2>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          1. Open <strong>Power BI Desktop → Get Data → Snowflake</strong>.
          <br />
          2. Enter your Snowflake Server URL, Warehouse (
          <code>EVIDENCE_VAULT_WH</code>), Database (
          <code>EVIDENCE_VAULT_ANALYTICS</code>), and Schema (<code>DR</code>).
          <br />
          3. Select all 5 synced tables above and click <strong>
            Refresh
          </strong>{" "}
          after running any DR drill here to update your RTO/RPO SLA &amp; Audit
          Compliance visuals.
        </p>
      </section>
    </main>
  );
}
