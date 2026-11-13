import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Server,
  AlertTriangle,
  CheckCircle2,
  Play,
  Zap,
  Bug,
  Download,
  Clock,
  FileCheck2,
  Terminal,
  LayoutGrid,
  List,
  Info,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "../context/AuthContext";
import { APP_CONFIG, USER_ROLES } from "../config/constants";
import { getDocuments } from "../services/documentService";
import {
  verifyMultiRegionDocument,
  recoverMultiRegionDocument,
  getDrillHistory,
  getRecoveryManifests,
} from "../services/recoveryService";
import { formatDate, formatSeconds } from "../services/dashboardUtils";

import "../styles/recovery.css";

export default function Recovery() {
  const { hasRole } = useAuth();
  const isAdminOrAuditor = hasRole([USER_ROLES.ADMIN, USER_ROLES.AUDITOR]);

  const [documents, setDocuments] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [verification, setVerification] = useState(null);
  const [lastDrillOutput, setLastDrillOutput] = useState(null);
  const [drills, setDrills] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [manifestView, setManifestView] = useState("CARDS");

  const [executionLogs, setExecutionLogs] = useState([]);
  const [runningAction, setRunningAction] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!runningAction) return;
    const start = performance.now();
    const timer = setInterval(() => {
      setElapsedMs(Math.round(performance.now() - start));
    }, 50);
    return () => clearInterval(timer);
  }, [runningAction]);

  const loadInitialData = useCallback(async () => {
    try {
      const docsPage = await getDocuments({ page: 0, size: 50 });
      const list = Array.isArray(docsPage?.content) ? docsPage.content : [];
      setDocuments(list);
      if (list.length > 0 && !selectedDocId) {
        setSelectedDocId(String(list[0].id));
      }

      if (isAdminOrAuditor) {
        const [drillList, manifestList] = await Promise.allSettled([
          getDrillHistory(),
          getRecoveryManifests(),
        ]);
        if (
          drillList.status === "fulfilled" &&
          Array.isArray(drillList.value)
        ) {
          setDrills(drillList.value);
        }
        if (
          manifestList.status === "fulfilled" &&
          Array.isArray(manifestList.value)
        ) {
          setManifests(manifestList.value);
        }
      }
    } catch (err) {
      setError(err?.message || "Failed to load recovery workspace.");
    }
  }, [isAdminOrAuditor, selectedDocId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const rtoTrendChart = useMemo(() => {
    return [...drills]
      .slice(0, 10)
      .reverse()
      .map((d, idx) => ({
        name: `#${d.id || idx + 1}`,
        rto: Number(d.rto_seconds || 0),
      }));
  }, [drills]);

  async function handleQuickVerify() {
    if (!selectedDocId) return;
    setRunningAction("verify");
    setElapsedMs(0);
    setError("");
    setSuccessMsg("");
    setExecutionLogs([
      {
        elapsed_seconds: 0.0,
        step: "VERIFY_START",
        detail: `Querying Mumbai (ap-south-1) and Singapore (ap-southeast-1) for Document #${selectedDocId}...`,
        level: "INFO",
      },
    ]);

    try {
      const res = await verifyMultiRegionDocument(Number(selectedDocId));
      setVerification(res);
      setExecutionLogs((prev) => [
        ...prev,
        {
          elapsed_seconds: 0.45,
          step: "VERIFY_RESULT",
          detail: `Mumbai SHA-256 Match: ${res.primary?.checksum_verified} | Singapore SHA-256 Match: ${res.secondary?.checksum_verified}`,
          level: res.overall_verified ? "SUCCESS" : "ERROR",
        },
      ]);
      setSuccessMsg("Dual-region cryptographic verification completed.");
    } catch (err) {
      setError(err?.message || "Verification failed.");
    } finally {
      setRunningAction("");
    }
  }

  async function handleStreamedDrill(mode, label) {
    if (!selectedDocId) return;
    const token = localStorage.getItem("evidence-vault-token");
    if (!token) {
      setError("Session expired. Please sign in again.");
      return;
    }

    setRunningAction(mode);
    setElapsedMs(0);
    setError("");
    setSuccessMsg("");
    setExecutionLogs([]);
    setLastDrillOutput(null);

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/v1/dr/drills/stream/${selectedDocId}?mode=${mode}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok || !response.body) {
        throw new Error(`Stream connection failed (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const rawEvent of events) {
          const dataLine = rawEvent
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));

          if (!dataLine) continue;
          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;

          const eventObj = JSON.parse(jsonStr);
          setExecutionLogs((prev) => [...prev, eventObj]);

          if (eventObj.payload?.before) {
            setVerification(eventObj.payload.before);
          }
          if (eventObj.step === "COMPLETED" && eventObj.payload) {
            setLastDrillOutput(eventObj.payload);
            if (eventObj.payload.verification) {
              setVerification(eventObj.payload.verification);
            }
            setSuccessMsg(
              `${label} finished! RTO achieved: ${eventObj.payload.drill?.rto_seconds}s.`,
            );
          }
          if (eventObj.step === "ERROR" || eventObj.step === "ABORTED") {
            setError(eventObj.detail);
          }
        }
      }

      await loadInitialData();
    } catch (err) {
      setError(err?.message || "Live DR stream interrupted.");
    } finally {
      setRunningAction("");
    }
  }

  async function handleDirectRecover() {
    if (!selectedDocId) return;
    setRunningAction("recover");
    setError("");
    setSuccessMsg("");
    try {
      await recoverMultiRegionDocument(Number(selectedDocId));
      setSuccessMsg(
        "Corrupted document restored from verified Singapore replica.",
      );
      await loadInitialData();
    } catch (err) {
      setError(err?.message || "Direct recovery failed.");
    } finally {
      setRunningAction("");
    }
  }

  function downloadManifestJson(manifest) {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recovery-manifest-${manifest.manifest_id || manifest.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const selectedDoc = documents.find(
    (d) => String(d.id) === String(selectedDocId),
  );

  return (
    <main className="recovery-page">
      <section className="recovery-heading">
        <div>
          <span className="recovery-eyebrow">
            REAL-TIME DISASTER RECOVERY STUDIO
          </span>
          <h1>DR Drill &amp; Failover Studio</h1>
          <p>
            Watch live step-by-step recovery logs as evidence is verified in
            Singapore and restored to Mumbai.
          </p>
        </div>

        <div className="sla-target-box">
          <div>
            <span>RTO Target (Downtime)</span>
            <strong>&lt; {APP_CONFIG.RTO_TARGET_SECONDS.toFixed(1)} sec</strong>
          </div>
          <div className="sla-divider" />
          <div>
            <span>RPO Target (Data Loss)</span>
            <strong>&lt; 15 min (S3 CRR)</strong>
          </div>
        </div>
      </section>

      <div className="explainer-banner">
        <Info size={20} />
        <div>
          <strong>
            Understanding Drill Timing (Why RTO is ~0.7s while total drill takes
            ~20s):
          </strong>{" "}
          <strong>1. Recovery Time Objective (RTO ~0.7s)</strong> is how fast
          the clean file is pulled from Singapore, SHA-256 verified, and
          restored into Mumbai—your file is usable immediately.{" "}
          <strong>2. Background CRR Observation (~20s)</strong> is post-recovery
          polling that waits for AWS S3 Cross-Region Replication to sync that
          newly restored Mumbai version back to Singapore.
        </div>
      </div>

      {successMsg && (
        <div className="recovery-alert recovery-alert-success">
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="recovery-alert recovery-alert-error">
          <ShieldAlert size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="recovery-control-panel">
        <div className="target-selector-row">
          <label htmlFor="dr-doc-select">Target Evidence Document</label>
          <select
            id="dr-doc-select"
            className="recovery-select"
            value={selectedDocId}
            onChange={(e) => {
              setSelectedDocId(e.target.value);
              setVerification(null);
              setLastDrillOutput(null);
            }}
            disabled={!!runningAction}
          >
            {documents.length === 0 && (
              <option value="">No documents available</option>
            )}
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                #{doc.id} — {doc.originalFilename} [{doc.status}]
              </option>
            ))}
          </select>

          {runningAction && (
            <div className="live-timer-pill">
              <Clock size={15} className="recovery-spin" />
              <span>Live Elapsed: {(elapsedMs / 1000).toFixed(2)}s</span>
            </div>
          )}
        </div>

        <div className="drill-actions-grid">
          <button
            className="drill-btn drill-btn-verify"
            disabled={!!runningAction || !selectedDocId}
            onClick={handleQuickVerify}
          >
            <ShieldCheck size={18} />
            <div>
              <strong>1. Instant Region Check</strong>
              <span>Verify SHA-256 in Mumbai &amp; Singapore</span>
            </div>
          </button>

          <button
            className="drill-btn drill-btn-normal"
            disabled={!!runningAction || !selectedDocId}
            onClick={() => handleStreamedDrill("normal", "Automated DR Check")}
          >
            <Play size={18} />
            <div>
              <strong>2. Automated DR Drill</strong>
              <span>Live audit &amp; auto-heal if needed</span>
            </div>
          </button>

          <button
            className="drill-btn drill-btn-outage"
            disabled={!!runningAction || !selectedDocId}
            onClick={() =>
              handleStreamedDrill("outage", "Mumbai Outage Failover")
            }
          >
            <Zap size={18} />
            <div>
              <strong>3. Simulate Mumbai Outage</strong>
              <span>Failover pull from Singapore replica</span>
            </div>
          </button>

          <button
            className="drill-btn drill-btn-corrupt"
            disabled={!!runningAction || !selectedDocId}
            onClick={() =>
              handleStreamedDrill("corruption", "Byte Corruption Recovery")
            }
          >
            <Bug size={18} />
            <div>
              <strong>4. Simulate Byte Corruption</strong>
              <span>Detect bit-flip &amp; restore clean version</span>
            </div>
          </button>
        </div>

        {selectedDoc?.status === "CORRUPTED" && (
          <div className="corrupted-recovery-banner">
            <div>
              <AlertTriangle size={20} />
              <span>
                Document #{selectedDoc.id} is currently flagged{" "}
                <strong>CORRUPTED</strong>. Restore the verified Singapore copy
                now.
              </span>
            </div>
            <button
              className="document-primary-button"
              disabled={!!runningAction}
              onClick={handleDirectRecover}
            >
              <RefreshCw size={16} />
              Restore Clean Replica
            </button>
          </div>
        )}
      </section>

      <section className="dr-visual-split">
        <div className="console-card">
          <div className="console-header">
            <Terminal size={17} />
            <h3>Live Streaming Execution Console (SSE)</h3>
            <span>Real-time step telemetry</span>
          </div>
          <div className="console-body">
            {executionLogs.length === 0 ? (
              <p className="console-placeholder">
                Select any drill above to stream live millisecond execution
                events here...
              </p>
            ) : (
              executionLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`console-line console-${String(log.level || "info").toLowerCase()}`}
                >
                  <span className="console-time">
                    [+{Number(log.elapsed_seconds || 0).toFixed(2)}s]
                  </span>
                  <strong className="console-step">{log.step}:</strong>
                  <span>{log.detail}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="console-card">
          <div className="console-header">
            <Clock size={17} />
            <h3>RTO Performance vs. 5.0s Target</h3>
          </div>
          {rtoTrendChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={215}>
              <BarChart data={rtoTrendChart}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(148,163,184,0.15)"
                />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={35} />
                <Tooltip
                  formatter={(val) => [
                    `${Number(val).toFixed(3)} sec`,
                    "Measured RTO",
                  ]}
                />
                <ReferenceLine
                  y={APP_CONFIG.RTO_TARGET_SECONDS}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                />
                <Bar dataKey="rto" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="console-placeholder">
              Execute a drill to plot RTO against your 5.0s SLA line.
            </p>
          )}
        </div>
      </section>

      {verification && (
        <section className="region-comparison-grid">
          <div className="region-box">
            <div className="region-box-header">
              <Server size={20} />
              <div>
                <h3>Primary Region — Mumbai</h3>
                <span>ap-south-1 · evidence-vault-primary-263554</span>
              </div>
              <span
                className={`document-status ${
                  verification.primary?.verified
                    ? "document-status-active"
                    : "document-status-deleted"
                }`}
              >
                {verification.primary?.verified ? "VERIFIED" : "FAILED"}
              </span>
            </div>
            <div className="region-kv">
              <span>Object Exists:</span>
              <strong>{verification.primary?.exists ? "Yes" : "No"}</strong>
            </div>
            <div className="region-kv">
              <span>Size Verified:</span>
              <strong>
                {verification.primary?.size_verified ? "Match" : "Mismatch"}
              </strong>
            </div>
            <div className="region-kv">
              <span>SHA-256 Verified:</span>
              <strong>
                {verification.primary?.checksum_verified ? "Match" : "Mismatch"}
              </strong>
            </div>
            <div className="region-kv">
              <span>Actual Digest:</span>
              <code>
                {verification.primary?.actual_checksum?.slice(0, 24) || "N/A"}
                ...
              </code>
            </div>
          </div>

          <div className="region-box">
            <div className="region-box-header">
              <Server size={20} />
              <div>
                <h3>Secondary Region — Singapore</h3>
                <span>ap-southeast-1 · evidence-vault-secondary-263554</span>
              </div>
              <span
                className={`document-status ${
                  verification.secondary?.verified
                    ? "document-status-active"
                    : "document-status-deleted"
                }`}
              >
                {verification.secondary?.verified ? "VERIFIED" : "FAILED"}
              </span>
            </div>
            <div className="region-kv">
              <span>Replica Exists:</span>
              <strong>{verification.secondary?.exists ? "Yes" : "No"}</strong>
            </div>
            <div className="region-kv">
              <span>Size Verified:</span>
              <strong>
                {verification.secondary?.size_verified ? "Match" : "Mismatch"}
              </strong>
            </div>
            <div className="region-kv">
              <span>SHA-256 Verified:</span>
              <strong>
                {verification.secondary?.checksum_verified
                  ? "Match"
                  : "Mismatch"}
              </strong>
            </div>
            <div className="region-kv">
              <span>Actual Digest:</span>
              <code>
                {verification.secondary?.actual_checksum?.slice(0, 24) || "N/A"}
                ...
              </code>
            </div>
          </div>
        </section>
      )}

      {lastDrillOutput?.drill && (
        <section className="drill-result-banner">
          <div className="drill-result-header">
            <FileCheck2 size={22} />
            <div>
              <h3>Drill Outcome: {lastDrillOutput.drill.drill_status}</h3>
              <p>
                <strong>
                  Evidence RTO:{" "}
                  {formatSeconds(lastDrillOutput.drill.rto_seconds)}
                </strong>{" "}
                · Total Observation Window:{" "}
                <strong>
                  {formatSeconds(lastDrillOutput.drill_duration_seconds)}
                </strong>
              </p>
            </div>
          </div>
          {lastDrillOutput.manifest?.manifest && (
            <button
              className="secondary-button"
              onClick={() =>
                downloadManifestJson(lastDrillOutput.manifest.manifest)
              }
            >
              <Download size={15} />
              Download Signed JSON Manifest
            </button>
          )}
        </section>
      )}

      {isAdminOrAuditor && (
        <section className="recovery-history-section">
          <div className="manifest-section-header">
            <h2>Cryptographic Recovery Manifests ({manifests.length})</h2>
            <div className="view-toggle-group">
              <button
                type="button"
                className={`view-toggle-btn ${manifestView === "CARDS" ? "active" : ""}`}
                onClick={() => setManifestView("CARDS")}
              >
                <LayoutGrid size={14} /> Cards
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${manifestView === "TABLE" ? "active" : ""}`}
                onClick={() => setManifestView("TABLE")}
              >
                <List size={14} /> Table
              </button>
            </div>
          </div>

          {manifests.length === 0 ? (
            <p className="recovery-muted">
              No recovery manifests recorded yet.
            </p>
          ) : manifestView === "CARDS" ? (
            <div className="evidence-cards-grid">
              {manifests.map((m) => (
                <article key={m.manifest_id || m.id} className="evidence-card">
                  <div className="evidence-card-top">
                    <div className="document-file-icon">
                      <FileCheck2 size={19} />
                    </div>
                    <div className="evidence-card-title">
                      <span className="evidence-id-tag">
                        DOC #{m.document_id} ·{" "}
                        {m.failure_type?.replaceAll("_", " ")}
                      </span>
                      <h3 title={m.manifest_id}>{m.manifest_id}</h3>
                    </div>
                    <span className="document-status document-status-active">
                      {m.verification_status}
                    </span>
                  </div>
                  <div className="evidence-card-meta">
                    <div>
                      <span>Failover Route</span>
                      <strong>
                        {m.source_region} → {m.destination_region}
                      </strong>
                    </div>
                    <div>
                      <span>Measured RTO</span>
                      <strong>{formatSeconds(m.rto_seconds)}</strong>
                    </div>
                    <div>
                      <span>Recovered Version</span>
                      <code>{m.recovered_version_id?.slice(0, 18)}...</code>
                    </div>
                  </div>
                  <div className="evidence-card-footer">
                    <button
                      className="card-action-btn"
                      onClick={() => downloadManifestJson(m)}
                    >
                      <Download size={14} /> Export Signed JSON
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="documents-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Manifest ID</th>
                    <th>Doc ID</th>
                    <th>Failure Type</th>
                    <th>Route</th>
                    <th>Recovered Version</th>
                    <th>Measured RTO</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Export</th>
                  </tr>
                </thead>
                <tbody>
                  {manifests.map((m) => (
                    <tr key={m.manifest_id || m.id}>
                      <td className="checksum-value">
                        {m.manifest_id?.slice(0, 14)}...
                      </td>
                      <td>#{m.document_id}</td>
                      <td>{m.failure_type?.replaceAll("_", " ")}</td>
                      <td>
                        {m.source_region} → {m.destination_region}
                      </td>
                      <td className="checksum-value">
                        {m.recovered_version_id?.slice(0, 14)}...
                      </td>
                      <td>
                        <strong>{formatSeconds(m.rto_seconds)}</strong>
                      </td>
                      <td>
                        <span className="document-status document-status-active">
                          {m.verification_status}
                        </span>
                      </td>
                      <td>{formatDate(m.created_at)}</td>
                      <td>
                        <button
                          className="icon-button"
                          onClick={() => downloadManifestJson(m)}
                        >
                          <Download size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
