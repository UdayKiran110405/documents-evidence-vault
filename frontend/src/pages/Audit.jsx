import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History,
  RefreshCw,
  Search,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  LayoutGrid,
  List,
  User,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getAllAuditLogs } from "../services/recoveryService";
import { formatDate } from "../services/dashboardUtils";

import "../styles/documents.css";

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [viewMode, setViewMode] = useState("CARDS");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAllAuditLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Unable to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const uniqueActions = useMemo(() => {
    return Array.from(new Set(logs.map((l) => l.action).filter(Boolean)));
  }, [logs]);

  const actionChartData = useMemo(() => {
    const map = {};
    logs.forEach((l) => {
      const key = String(l.action || "OTHER").replace("DOCUMENT_", "");
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        String(log.documentId || "").includes(q) ||
        (log.username || "").toLowerCase().includes(q) ||
        (log.action || "").toLowerCase().includes(q) ||
        (log.details || "").toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, searchTerm]);

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">IMMUTABLE COMPLIANCE LEDGER</span>
          <h1>Audit &amp; Access Trail</h1>
          <p>
            Chronological evidence of uploads, version changes, integrity
            failures, soft-deletes, and restores.
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
            onClick={loadLogs}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "documents-spin" : ""} />
            Refresh Trail
          </button>
        </div>
      </section>

      {actionChartData.length > 0 && (
        <section className="vault-chart-card" style={{ marginBottom: 22 }}>
          <h3>Security &amp; Compliance Operations Breakdown</h3>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={actionChartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(148,163,184,0.15)"
              />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
              <Tooltip />
              <Bar dataKey="count" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {error && (
        <div className="document-alert document-alert-error">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}

      <section className="document-toolbar">
        <div className="document-search-form">
          <div className="document-search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Filter by username, document ID, or details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="document-filter-input"
            style={{ width: "240px" }}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All audit actions</option>
            {uniqueActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <div className="documents-empty-state">
          <RefreshCw className="documents-spin" size={24} />
          <p>Loading compliance audit logs...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="documents-empty-state">
          <ShieldCheck size={34} />
          <h3>No matching audit events</h3>
          <p>
            Perform document uploads, previews, or recovery drills to generate
            audit trails.
          </p>
        </div>
      ) : viewMode === "CARDS" ? (
        <section className="evidence-cards-grid">
          {filteredLogs.map((log) => {
            const isFailure =
              String(log.action).includes("FAILURE") ||
              String(log.action).includes("CORRUPTION");
            return (
              <article key={log.id} className="evidence-card">
                <div className="evidence-card-top">
                  <div className="document-file-icon">
                    <History size={19} />
                  </div>
                  <div className="evidence-card-title">
                    <span className="evidence-id-tag">
                      EVENT #{log.id}{" "}
                      {log.documentId ? `· DOC #${log.documentId}` : ""}
                    </span>
                    <h3>{log.action}</h3>
                  </div>
                  <span
                    className={`document-status ${
                      isFailure
                        ? "document-status-deleted"
                        : "document-status-active"
                    }`}
                  >
                    {isFailure ? "ALERT" : "VERIFIED"}
                  </span>
                </div>

                <p className="evidence-card-desc">{log.details}</p>

                <div className="evidence-card-meta">
                  <div>
                    <span>Actor</span>
                    <strong>
                      <User size={11} style={{ marginRight: 4 }} />
                      {log.username}
                    </strong>
                  </div>
                  <div>
                    <span>Timestamp</span>
                    <strong>{formatDate(log.createdAt)}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="documents-table-card">
          <div className="documents-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Document ID</th>
                  <th>Cryptographic &amp; Operational Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const isFailure =
                    String(log.action).includes("FAILURE") ||
                    String(log.action).includes("CORRUPTION");
                  return (
                    <tr key={log.id}>
                      <td>#{log.id}</td>
                      <td>{formatDate(log.createdAt)}</td>
                      <td>
                        <strong>{log.username}</strong>
                      </td>
                      <td>
                        <span
                          className={`document-status ${
                            isFailure
                              ? "document-status-deleted"
                              : "document-status-active"
                          }`}
                        >
                          {isFailure && (
                            <ShieldAlert size={12} style={{ marginRight: 4 }} />
                          )}
                          {log.action}
                        </span>
                      </td>
                      <td>{log.documentId ? `#${log.documentId}` : "—"}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: "460px" }}>
                        {log.details}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
