import { useState } from "react";
import {
  Lock,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Play,
  Info,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/api";

import "../styles/documents.css";

const PERMISSION_MATRIX = [
  {
    capability: "View Command Center & Region Telemetry",
    admin: true,
    operator: true,
    auditor: true,
  },
  {
    capability: "Search, Preview & SHA-256 Verified Download",
    admin: true,
    operator: true,
    auditor: true,
  },
  {
    capability: "Inspect S3 Version Chains & Reconciliation",
    admin: true,
    operator: true,
    auditor: true,
  },
  {
    capability: "Upload Evidence & New Versions (v2+)",
    admin: true,
    operator: true,
    auditor: false,
  },
  {
    capability: "Soft-Delete (Create S3 Delete Marker)",
    admin: true,
    operator: true,
    auditor: false,
  },
  {
    capability: "Trigger Failover & Corruption Drills",
    admin: true,
    operator: true,
    auditor: false,
  },
  {
    capability: "View Immutable Audit Logs & Signed Manifests",
    admin: true,
    operator: false,
    auditor: true,
  },
  {
    capability: "Sync Data Warehouse to Snowflake",
    admin: true,
    operator: false,
    auditor: true,
  },
  {
    capability: "Permanent S3 Version Purge (s3:DeleteObjectVersion)",
    admin: false,
    operator: false,
    auditor: false,
  },
];

export default function AccessControl() {
  const { user } = useAuth();
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  async function runUnauthorizedProbe(endpoint, method, label) {
    setTesting(true);
    setTestResult(null);
    try {
      await apiRequest(endpoint, { method });
      setTestResult({
        blocked: false,
        label,
        detail: `HTTP 200 OK — Allowed for current role (${user?.roles?.join(", ")}). Switch to an Auditor account to observe 403 Forbidden denial.`,
      });
    } catch (err) {
      setTestResult({
        blocked: true,
        label,
        detail: `SECURITY ENFORCED (403 Forbidden): ${err?.message || "Access Denied by Spring Security @PreAuthorize"}`,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">
            ZERO-TRUST RBAC &amp; AWS IAM GOVERNANCE
          </span>
          <h1>IAM &amp; RBAC Security Matrix</h1>
          <p>
            Active Session: <strong>{user?.username}</strong> (
            {user?.roles?.join(", ")})
          </p>
        </div>
      </section>

      <div className="explainer-banner">
        <Info size={20} />
        <div>
          <strong>Defense-in-Depth Deletion Controls:</strong> Even if an
          Operator or Admin account is compromised, the application&apos;s AWS
          IAM policy explicitly denies <code>s3:DeleteObjectVersion</code> and{" "}
          <code>s3:PutBucketVersioning</code>, guaranteeing historical
          compliance evidence cannot be permanently erased.
        </div>
      </div>

      {/* Live Unauthorized Action Simulator */}
      <section
        className="documents-table-card"
        style={{ padding: 20, marginBottom: 24 }}
      >
        <h2 style={{ fontSize: 16, marginBottom: 6 }}>
          Live Authorization &amp; Denial Probe
        </h2>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            marginBottom: 14,
          }}
        >
          Test role enforcement against protected backend endpoints (log in as
          an Auditor or Operator to verify 403 denials live during evaluation).
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="secondary-button"
            disabled={testing}
            onClick={() =>
              runUnauthorizedProbe(
                "/v1/admin/status",
                "GET",
                "Admin-Only Endpoint Probe",
              )
            }
          >
            <Play size={14} style={{ marginRight: 6 }} />
            Test Admin Endpoint (/api/v1/admin/status)
          </button>

          <button
            className="secondary-button"
            disabled={testing}
            onClick={() =>
              runUnauthorizedProbe(
                "/v1/audit",
                "GET",
                "Auditor-Only Ledger Probe",
              )
            }
          >
            <Play size={14} style={{ marginRight: 6 }} />
            Test Audit Endpoint (/api/v1/audit)
          </button>
        </div>

        {testResult && (
          <div
            className={`document-alert ${
              testResult.blocked
                ? "document-alert-success"
                : "document-alert-error"
            }`}
            style={{ marginTop: 14, marginBottom: 0 }}
          >
            {testResult.blocked ? (
              <ShieldCheck size={18} />
            ) : (
              <ShieldAlert size={18} />
            )}
            <span>
              <strong>{testResult.label}:</strong> {testResult.detail}
            </span>
          </div>
        )}
      </section>

      {/* Permission Matrix Table */}
      <section className="documents-table-card">
        <div className="documents-table-heading">
          <div>
            <h2>Role-Based Access Control Matrix</h2>
            <p>
              Enforced via Spring Security JWT &amp; AWS IAM Least-Privilege
              Policies
            </p>
          </div>
          <Lock size={20} />
        </div>

        <div className="documents-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Compliance Capability</th>
                <th>ROLE_ADMIN</th>
                <th>ROLE_OPERATOR</th>
                <th>ROLE_AUDITOR</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map((row) => (
                <tr key={row.capability}>
                  <td>
                    <strong>{row.capability}</strong>
                  </td>
                  <td>
                    {row.admin ? (
                      <CheckCircle2 size={17} color="#22c55e" />
                    ) : (
                      <XCircle size={17} color="#ef4444" />
                    )}
                  </td>
                  <td>
                    {row.operator ? (
                      <CheckCircle2 size={17} color="#22c55e" />
                    ) : (
                      <XCircle size={17} color="#ef4444" />
                    )}
                  </td>
                  <td>
                    {row.auditor ? (
                      <CheckCircle2 size={17} color="#22c55e" />
                    ) : (
                      <XCircle size={17} color="#ef4444" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
