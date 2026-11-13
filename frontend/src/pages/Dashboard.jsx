import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  FileCheck2,
  FileText,
  Globe,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "../context/AuthContext";
import { APP_CONFIG, ROUTES, USER_ROLES } from "../config/constants";
import { getDashboardData } from "../services/dashboardService";
import { apiRequest } from "../services/api";

import {
  normalizeArray,
  calculateDrillSummary,
  calculateMetricSummary,
  getLatestRecord,
  formatSeconds,
  formatDate,
} from "../services/dashboardUtils";

import { formatFileSize } from "../services/documentUtils";

import "../styles/dashboard.css";

function StatCard({ title, value, subtitle, icon: Icon, tone = "blue" }) {
  return (
    <article className="dashboard-stat-card">
      <div className={`stat-icon stat-icon-${tone}`}>
        <Icon size={21} />
      </div>

      <div className="stat-content">
        <p>{title}</p>
        <h2>{value}</h2>
        <span>{subtitle}</span>
      </div>
    </article>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "UNKNOWN").toUpperCase();

  let className = "status-neutral";
  if (
    ["SUCCESS", "COMPLETED", "UP", "VERIFIED", "SYNCED", "ACTIVE"].includes(
      normalized,
    )
  ) {
    className = "status-success";
  } else if (
    ["FAILED", "DOWN", "ERROR", "MISMATCH", "CORRUPTED", "DELETED"].includes(
      normalized,
    )
  ) {
    className = "status-danger";
  } else if (["RECOVERY_REQUIRED", "PENDING", "WARNING"].includes(normalized)) {
    className = "status-warning";
  }

  return (
    <span className={`status-badge ${className}`}>
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function EmptyState({ message }) {
  return <div className="dashboard-empty">{message}</div>;
}

export default function Dashboard() {
  const { hasRole } = useAuth();
  const canMutate = hasRole([USER_ROLES.ADMIN, USER_ROLES.OPERATOR]);
  const canViewDr = hasRole([USER_ROLES.ADMIN, USER_ROLES.AUDITOR]);

  const [dashboard, setDashboard] = useState(null);
  const [regionScan, setRegionScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [bannerMsg, setBannerMsg] = useState("");
  const [pageError, setPageError] = useState("");

  const loadDashboard = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setPageError("");

      try {
        const [baseResult, regionResult] = await Promise.allSettled([
          getDashboardData({ includeRecoveryData: canViewDr }),
          apiRequest("/v1/dr/regions/status"),
        ]);

        if (baseResult.status === "fulfilled") {
          setDashboard(baseResult.value);
        } else {
          setPageError(
            baseResult.reason?.message || "Unable to load dashboard data.",
          );
        }

        if (regionResult.status === "fulfilled") {
          setRegionScan(regionResult.value);
        }
      } catch (error) {
        setPageError(error?.message || "Unable to load dashboard data.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canViewDr],
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleSeedDemo() {
    setSeeding(true);
    setBannerMsg("");
    setPageError("");
    try {
      const seeded = await apiRequest("/v1/documents/seed-demo", {
        method: "POST",
      });
      const count = Array.isArray(seeded) ? seeded.length : 0;
      setBannerMsg(
        count > 0
          ? `Seeded ${count} synthetic compliance documents into Mumbai S3 & MySQL!`
          : "Synthetic compliance dataset already exists in your vault.",
      );
      await loadDashboard(true);
    } catch (err) {
      setPageError(err?.message || "Failed to seed synthetic compliance data.");
    } finally {
      setSeeding(false);
    }
  }

  const metrics = useMemo(
    () => normalizeArray(dashboard?.metrics),
    [dashboard],
  );
  const drills = useMemo(() => normalizeArray(dashboard?.drills), [dashboard]);
  const manifests = useMemo(
    () => normalizeArray(dashboard?.manifests),
    [dashboard],
  );

  const drillSummary = useMemo(() => calculateDrillSummary(drills), [drills]);
  const metricSummary = useMemo(
    () => calculateMetricSummary(metrics),
    [metrics],
  );
  const latestDrill = useMemo(() => getLatestRecord(drills), [drills]);
  const latestManifest = useMemo(() => getLatestRecord(manifests), [manifests]);

  const docStats = dashboard?.documents || {
    total: 0,
    active: 0,
    deleted: 0,
    corrupted: 0,
    recent: [],
  };

  const userCount = dashboard?.system?.totalUsers ?? "N/A";
  const syncedDocs = regionScan?.synced_count ?? 0;
  const totalScanned = regionScan?.total_documents ?? docStats.total;

  const rtoChartData = useMemo(() => {
    return [...metrics]
      .filter(
        (item) =>
          item.recovery_rto_seconds !== null &&
          item.recovery_rto_seconds !== undefined,
      )
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(-8)
      .map((item, index) => ({
        name: formatDate(item.created_at),
        rto: Number(item.recovery_rto_seconds),
        label: `Drill #${index + 1}`,
      }));
  }, [metrics]);

  const drillChartData = [
    { name: "Successful", value: drillSummary.successful },
    { name: "Failed", value: drillSummary.failed },
    { name: "Attention required", value: drillSummary.attentionRequired },
  ].filter((item) => item.value > 0);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="loading-spin" size={25} />
        <p>Loading Command Center...</p>
      </div>
    );
  }

  const system = dashboard?.system;
  const drFetchError =
    dashboard?.errors?.drills ||
    dashboard?.errors?.metrics ||
    dashboard?.errors?.manifests;

  return (
    <main className="dashboard-page">
      {/* Header */}
      <section className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">
            DOCUMENT EVIDENCE VAULT · COMMAND CENTER
          </span>
          <h1>Resilience &amp; Compliance Overview</h1>
          <p>
            Monitor document protection, cross-region replication parity, and
            disaster recovery performance.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {canMutate && (
            <button
              className="document-primary-button"
              onClick={handleSeedDemo}
              disabled={seeding}
            >
              <Sparkles size={16} />
              {seeding ? "Seeding Vault..." : "Seed Compliance Dataset"}
            </button>
          )}

          <button
            className="refresh-button"
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "loading-spin" : ""} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {bannerMsg && (
        <div className="document-alert document-alert-success">
          <CheckCircle2 size={17} />
          <span>{bannerMsg}</span>
        </div>
      )}

      {(pageError || drFetchError) && (
        <div className="dashboard-warning">
          <AlertTriangle size={17} />
          <span>{pageError || `DR Telemetry Notice: ${drFetchError}`}</span>
        </div>
      )}

      {/* Plain-English System Explainer */}
      <div className="explainer-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>How EvidenceVault Protects Compliance Records:</strong> Every
          uploaded file is hashed with <strong>SHA-256</strong>, stored with
          immutable versioning in <strong>Mumbai (ap-south-1)</strong>, and
          replicated asynchronously to{" "}
          <strong>Singapore (ap-southeast-1)</strong>. Any accidental deletion
          or bit corruption is detected automatically and recovered with a
          signed JSON manifest.
        </div>
      </div>

      {/* Infrastructure & Live Region Parity */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Infrastructure &amp; Vault Inventory</h2>
            <p>
              Real-time health of Spring Boot, MySQL, S3 Parity, and Vault
              document breakdown
            </p>
          </div>
          <Activity size={20} />
        </div>

        <div className="infrastructure-grid">
          <div className="infrastructure-card">
            <div className="infrastructure-icon">
              <Cloud size={22} />
            </div>
            <div>
              <span>Spring Boot Vault API</span>
              <StatusBadge status={system?.application || "UP"} />
            </div>
          </div>

          <div className="infrastructure-card">
            <div className="infrastructure-icon">
              <Database size={22} />
            </div>
            <div>
              <span>MySQL Metadata Store</span>
              <StatusBadge status={system?.database || "UP"} />
            </div>
          </div>

          <div className="infrastructure-card">
            <div className="infrastructure-icon">
              <Globe size={22} />
            </div>
            <div>
              <span>Live S3 Parity (IN ⇄ SG)</span>
              <strong>
                {syncedDocs} / {totalScanned} Synced
              </strong>
            </div>
          </div>

          <div className="infrastructure-card">
            <div className="infrastructure-icon">
              <FileText size={22} />
            </div>
            <div>
              <span>Evidence Vault ({docStats.total} Total)</span>
              <strong>
                {docStats.active} Active · {docStats.deleted} Deleted ·{" "}
                {docStats.corrupted} Corrupted
              </strong>
            </div>
          </div>
        </div>
      </section>

      {/* Main DR KPI Cards */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Disaster Recovery Performance</h2>
            <p>Measurements from recorded cross-region recovery operations</p>
          </div>
          <ShieldCheck size={20} />
        </div>

        <div className="dashboard-stats-grid">
          <StatCard
            title="Total DR Drills"
            value={drillSummary.total}
            subtitle="Recorded drill operations"
            icon={Activity}
            tone="blue"
          />

          <StatCard
            title="Drill Success Rate"
            value={
              drillSummary.successRate === null
                ? "N/A"
                : `${drillSummary.successRate}%`
            }
            subtitle={`${drillSummary.successful} successful drills`}
            icon={CheckCircle2}
            tone="green"
          />

          <StatCard
            title="Average Recovery Time (RTO)"
            value={formatSeconds(metricSummary.averageRto)}
            subtitle={`SLA Target: < ${APP_CONFIG.RTO_TARGET_SECONDS.toFixed(1)} sec`}
            icon={Clock3}
            tone="purple"
          />

          <StatCard
            title="Average Estimated RPO"
            value={formatSeconds(metricSummary.averageRpo)}
            subtitle="Cross-region timestamp estimate"
            icon={ArrowDownToLine}
            tone="orange"
          />

          <StatCard
            title="Recovery Operations"
            value={drillSummary.recoveryOperations}
            subtitle={`${drillSummary.corruptionDrills} corruption · ${drillSummary.primaryFailures} outage`}
            icon={RefreshCw}
            tone="blue"
          />

          <StatCard
            title="Signed Recovery Manifests"
            value={manifests.length}
            subtitle={`${userCount} registered IAM identities`}
            icon={FileCheck2}
            tone="green"
          />
        </div>
      </section>

      {/* Regional Verification Topology */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Regional Verification Topology</h2>
            <p>
              Latest cryptographic verification status across primary and
              secondary S3 buckets
            </p>
          </div>
          <HardDrive size={20} />
        </div>

        <div className="region-grid">
          <div className="region-card">
            <div className="region-top">
              <div className="region-icon">IN</div>
              <div>
                <h3>Primary Region — Mumbai</h3>
                <span>ap-south-1 · evidence-vault-primary-263554</span>
              </div>
            </div>

            <div className="region-result">
              <span>Last recorded verification</span>
              <StatusBadge
                status={
                  latestDrill?.primary_verified === true
                    ? "VERIFIED"
                    : latestDrill?.primary_verified === false
                      ? "FAILED"
                      : "UNKNOWN"
                }
              />
            </div>
          </div>

          <div className="region-connection">
            <div className="connection-line"></div>
            <span>S3 Cross-Region Replication</span>
            <div className="connection-line"></div>
          </div>

          <div className="region-card">
            <div className="region-top">
              <div className="region-icon region-icon-secondary">SG</div>
              <div>
                <h3>Secondary Region — Singapore</h3>
                <span>ap-southeast-1 · evidence-vault-secondary-263554</span>
              </div>
            </div>

            <div className="region-result">
              <span>Last recorded verification</span>
              <StatusBadge
                status={
                  latestDrill?.secondary_verified === true
                    ? "VERIFIED"
                    : latestDrill?.secondary_verified === false
                      ? "FAILED"
                      : "UNKNOWN"
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* Replication & Integrity Summaries */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Replication &amp; Integrity Summary</h2>
            <p>
              Recorded S3 replication status and SHA-256 verification metrics
            </p>
          </div>
          <ShieldCheck size={20} />
        </div>

        <div className="analysis-grid">
          <div className="analysis-card">
            <h3>Replication Summary</h3>

            <div className="analysis-row">
              <span>Completed</span>
              <strong className="text-success">
                {metricSummary.replicationCompleted}
              </strong>
            </div>

            <div className="analysis-row">
              <span>Failed</span>
              <strong className="text-danger">
                {metricSummary.replicationFailed}
              </strong>
            </div>

            <div className="analysis-row">
              <span>Timed out</span>
              <strong>{metricSummary.replicationTimedOut}</strong>
            </div>

            <div className="analysis-row">
              <span>Corruption drills</span>
              <strong>{drillSummary.corruptionDrills}</strong>
            </div>

            <div className="analysis-row">
              <span>Primary failure drills</span>
              <strong>{drillSummary.primaryFailures}</strong>
            </div>
          </div>

          <div className="analysis-card">
            <h3>Integrity Summary</h3>

            <div className="integrity-highlight">
              {drillSummary.checksumMismatches === 0 ? (
                <CheckCircle2 size={27} />
              ) : (
                <AlertTriangle size={27} />
              )}

              <div>
                <strong>{drillSummary.checksumMismatches}</strong>
                <span>Unresolved post-drill checksum mismatches</span>
              </div>
            </div>

            <p>
              Every recovery drill verifies SHA-256 digests before and after
              failover to ensure bit-level integrity.
            </p>

            <div className="analysis-row">
              <span>Drills requiring attention</span>
              <strong>{drillSummary.attentionRequired}</strong>
            </div>

            <div className="analysis-row">
              <span>Failed drills</span>
              <strong>{drillSummary.failed}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Analytics Charts */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Recovery Analytics</h2>
            <p>Measured RTO vs. 5.0s SLA target and drill outcomes</p>
          </div>
          <ArrowUpRight size={20} />
        </div>

        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-heading">
              <h3>Recovery Time Trend (RTO)</h3>
              <span>Seconds per drill (Red line = 5.0s SLA)</span>
            </div>

            {rtoChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rtoChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(148,163,184,0.15)"
                  />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={40} />
                  <Tooltip
                    formatter={(value) => [
                      `${Number(value).toFixed(3)} sec`,
                      "Measured RTO",
                    ]}
                  />
                  <ReferenceLine
                    y={APP_CONFIG.RTO_TARGET_SECONDS}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                  />
                  <Bar
                    dataKey="rto"
                    name="Recovery time"
                    fill="#38bdf8"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No recovery time measurements available yet. Run a drill in DR Drill Studio." />
            )}
          </div>

          <div className="chart-card">
            <div className="chart-heading">
              <h3>Drill Outcomes</h3>
              <span>Recorded drill statuses</span>
            </div>

            {drillChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={drillChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={4}
                  >
                    {drillChartData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={["#22c55e", "#ef4444", "#f59e0b"][index % 3]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No drill outcomes available yet." />
            )}
          </div>
        </div>
      </section>

      {/* Latest Signed Manifest */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Latest Signed Recovery Manifest</h2>
            <p>Most recently recorded cryptographic recovery proof</p>
          </div>
          <FileCheck2 size={20} />
        </div>

        {latestManifest ? (
          <div className="manifest-card">
            <div className="manifest-icon">
              <FileCheck2 size={24} />
            </div>

            <div className="manifest-details">
              <h3>{latestManifest.manifest_id || "Recovery manifest"}</h3>
              <p>
                Document #{latestManifest.document_id} ·{" "}
                {latestManifest.failure_type?.replaceAll("_", " ")} ·{" "}
                {latestManifest.source_region} →{" "}
                {latestManifest.destination_region}
              </p>
              <span>Created: {formatDate(latestManifest.created_at)}</span>
            </div>

            <div className="manifest-status">
              <StatusBadge status={latestManifest.verification_status} />
              <strong>{formatSeconds(latestManifest.rto_seconds)}</strong>
              <span>Recorded RTO</span>
            </div>
          </div>
        ) : (
          <EmptyState message="No recovery manifests have been recorded yet." />
        )}
      </section>

      {/* Recent Evidence Records Table */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Recent Evidence Records</h2>
            <p>Latest files protected in the vault</p>
          </div>
          <FileText size={20} />
        </div>

        {docStats.recent.length > 0 ? (
          <div className="table-wrapper">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Filename</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>SHA-256 Digest</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {docStats.recent.map((doc) => (
                  <tr key={doc.id}>
                    <td>#{doc.id}</td>
                    <td>
                      <strong>{doc.originalFilename}</strong>
                    </td>
                    <td>{doc.category}</td>
                    <td>{formatFileSize(doc.fileSizeBytes)}</td>
                    <td style={{ fontFamily: "monospace" }}>
                      {doc.sha256Checksum?.slice(0, 16)}...
                    </td>
                    <td>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td>{formatDate(doc.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No evidence documents uploaded yet." />
        )}
      </section>

      {/* Recent DR Activity Table */}
      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>Recent Disaster Recovery Activity</h2>
            <p>Latest recorded drill executions</p>
          </div>
          <Activity size={20} />
        </div>

        {drills.length > 0 ? (
          <div className="table-wrapper">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Failure Type</th>
                  <th>Primary (IN)</th>
                  <th>Secondary (SG)</th>
                  <th>RTO</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>

              <tbody>
                {drills.slice(0, 8).map((drill, index) => (
                  <tr key={drill.id ?? index}>
                    <td>#{drill.document_id}</td>
                    <td>{drill.failure_type?.replaceAll("_", " ") || "N/A"}</td>
                    <td>
                      <StatusBadge
                        status={drill.primary_verified ? "VERIFIED" : "FAILED"}
                      />
                    </td>
                    <td>
                      <StatusBadge
                        status={
                          drill.secondary_verified ? "VERIFIED" : "FAILED"
                        }
                      />
                    </td>
                    <td>
                      <strong>{formatSeconds(drill.rto_seconds)}</strong>
                    </td>
                    <td>
                      <StatusBadge status={drill.drill_status} />
                    </td>
                    <td>{formatDate(drill.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No disaster recovery activity recorded yet." />
        )}
      </section>

      {/* Quick Navigation Cards */}
      <section className="quick-nav-grid">
        <Link to={ROUTES.DOCUMENTS} className="quick-nav-card">
          <div>
            <h3>Evidence Vault &amp; Versions</h3>
            <p>
              Upload files, inspect S3 version chains, reconcile metadata, or
              inject test corruption.
            </p>
          </div>
          <ArrowUpRight size={20} />
        </Link>

        <Link to={ROUTES.RECOVERY} className="quick-nav-card">
          <div>
            <h3>DR Drill Studio (Live SSE)</h3>
            <p>
              Watch live step-by-step failover &amp; corruption recovery logs
              between Mumbai &amp; Singapore.
            </p>
          </div>
          <ArrowUpRight size={20} />
        </Link>
      </section>
    </main>
  );
}
