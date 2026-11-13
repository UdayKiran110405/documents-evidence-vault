import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  RefreshCw,
  CheckCircle2,
  Clock,
  Server,
  LayoutGrid,
  List,
  Info,
} from "lucide-react";

import { apiRequest } from "../services/api";
import { formatFileSize } from "../services/documentUtils";

import "../styles/documents.css";

export default function MultiRegionMonitor() {
  const [data, setData] = useState(null);
  const [viewMode, setViewMode] = useState("CARDS");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const scanRegions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("/v1/dr/regions/status");
      setData(res);
    } catch (err) {
      setError(err?.message || "Failed to scan regional S3 buckets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scanRegions();
  }, [scanRegions]);

  const docs = Array.isArray(data?.documents) ? data.documents : [];

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">
            CROSS-REGION REPLICATION TELEMETRY
          </span>
          <h1>Multi-Region Sync Monitor</h1>
          <p>
            Live object version parity across Primary (<code>ap-south-1</code>)
            and Secondary (<code>ap-southeast-1</code>).
          </p>
        </div>

        <div className="heading-action-group">
          <div className="view-toggle-group">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "CARDS" ? "active" : ""}`}
              onClick={() => setViewMode("CARDS")}
            >
              <LayoutGrid size={15} /> Cards
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "TABLE" ? "active" : ""}`}
              onClick={() => setViewMode("TABLE")}
            >
              <List size={15} /> Table
            </button>
          </div>

          <button
            className="document-primary-button"
            onClick={scanRegions}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "documents-spin" : ""} />
            Scan Both Regions
          </button>
        </div>
      </section>

      <div className="explainer-banner">
        <Info size={20} />
        <div>
          <strong>What is Cross-Region Parity?</strong> AWS S3 Cross-Region
          Replication (CRR) copies every newly uploaded version from Mumbai to
          Singapore asynchronously. This monitor checks live <code>HEAD</code>{" "}
          metadata in both buckets to confirm the exact S3 Version ID and byte
          size match across continents.
        </div>
      </div>

      {data && (
        <section className="document-summary-grid">
          <div className="document-summary-card">
            <div className="document-summary-icon">
              <Server size={21} />
            </div>
            <div>
              <span>Scanned Evidence Objects</span>
              <strong>{data.total_documents}</strong>
            </div>
          </div>

          <div className="document-summary-card">
            <div className="document-summary-icon summary-green">
              <CheckCircle2 size={21} />
            </div>
            <div>
              <span>Verified in Both Regions</span>
              <strong>{data.synced_count} Synced</strong>
            </div>
          </div>

          <div className="document-summary-card">
            <div className="document-summary-icon summary-purple">
              <Clock size={21} />
            </div>
            <div>
              <span>Pending CRR / Drift</span>
              <strong>{data.pending_or_drift_count}</strong>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="document-alert document-alert-error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="documents-empty-state">
          <RefreshCw className="documents-spin" size={25} />
          <p>Querying Mumbai &amp; Singapore S3 buckets...</p>
        </div>
      ) : viewMode === "CARDS" ? (
        <section className="evidence-cards-grid">
          {docs.map((item) => (
            <article key={item.document_id} className="evidence-card">
              <div className="evidence-card-top">
                <div className="document-file-icon">
                  <Globe size={20} />
                </div>
                <div className="evidence-card-title">
                  <span className="evidence-id-tag">
                    #{item.document_id} · {item.category}
                  </span>
                  <h3>{item.filename}</h3>
                </div>
                <span
                  className={`document-status ${
                    item.parity_verified
                      ? "document-status-active"
                      : "document-status-deleted"
                  }`}
                >
                  {item.parity_verified ? "IN + SG SYNCED" : "REPLICATING"}
                </span>
              </div>

              <div className="evidence-card-meta">
                <div>
                  <span>Mumbai (ap-south-1)</span>
                  <strong>
                    {item.primary?.exists
                      ? `Exists (${formatFileSize(item.primary.size_bytes)})`
                      : "Missing"}
                  </strong>
                </div>
                <div>
                  <span>Singapore (ap-southeast-1)</span>
                  <strong>
                    {item.secondary?.exists
                      ? `Exists (${formatFileSize(item.secondary.size_bytes)})`
                      : "Pending"}
                  </strong>
                </div>
                <div>
                  <span>Replicated Version ID</span>
                  <code>{item.version_id?.slice(0, 22) || "N/A"}...</code>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="documents-table-card">
          <div className="documents-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Doc ID</th>
                  <th>Filename</th>
                  <th>S3 Version ID</th>
                  <th>Mumbai (ap-south-1)</th>
                  <th>Singapore (ap-southeast-1)</th>
                  <th>CRR Status</th>
                  <th>Parity</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((item) => (
                  <tr key={item.document_id}>
                    <td>#{item.document_id}</td>
                    <td>
                      <strong>{item.filename}</strong>
                    </td>
                    <td className="checksum-value">
                      {item.version_id?.slice(0, 16) || "N/A"}...
                    </td>
                    <td>
                      {item.primary?.exists
                        ? formatFileSize(item.primary.size_bytes)
                        : "Missing"}
                    </td>
                    <td>
                      {item.secondary?.exists
                        ? formatFileSize(item.secondary.size_bytes)
                        : "Pending"}
                    </td>
                    <td>{item.primary?.replication_status || "UNKNOWN"}</td>
                    <td>
                      <span
                        className={`document-status ${
                          item.parity_verified
                            ? "document-status-active"
                            : "document-status-deleted"
                        }`}
                      >
                        {item.parity_verified ? "SYNCED" : "PENDING"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
