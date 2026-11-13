import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Upload,
  Download,
  Eye,
  Trash2,
  RotateCcw,
  FileText,
  FileImage,
  File,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Layers,
  ShieldCheck,
  ShieldAlert,
  GitCompare,
  Bug,
  LayoutGrid,
  List,
  ArchiveRestore,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "../context/AuthContext";
import { DOCUMENT_CATEGORIES, USER_ROLES } from "../config/constants";
import {
  getDocuments,
  uploadDocument,
  deleteDocument,
  restoreDocument,
  downloadDocument,
  previewDocument,
  simulateDocumentCorruption,
  getDocumentVersions,
  getDocumentVersionHistory,
  uploadNewDocumentVersion,
  restoreHistoricalVersion,
  downloadHistoricalVersion,
  reconcileDocumentVersions,
  verifyHistoricalVersionIntegrity,
} from "../services/documentService";

import {
  formatFileSize,
  formatDocumentDate,
  getFileExtension,
  isPreviewable,
  getDocumentStatus,
} from "../services/documentUtils";

import "../styles/documents.css";

const PAGE_SIZE = 12;

function DocumentIcon({ contentType }) {
  if (contentType?.startsWith("image/")) return <FileImage size={20} />;
  if (contentType === "application/pdf") return <FileText size={20} />;
  return <File size={20} />;
}

function DocumentStatusBadge({ status }) {
  const value = getDocumentStatus(status);
  const className =
    value === "ACTIVE"
      ? "document-status-active"
      : value === "DELETED" || value === "CORRUPTED"
        ? "document-status-deleted"
        : "document-status-neutral";

  return (
    <span className={`document-status ${className}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function UploadModal({ onClose, onUpload, uploading }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("GENERAL");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    if (!file) {
      setValidationError("Please select a document (PDF, PNG, JPG, or TXT).");
      return;
    }
    setValidationError("");
    onUpload(file, category, description);
  }

  return (
    <div
      className="document-modal-overlay"
      onClick={uploading ? undefined : onClose}
    >
      <section className="document-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <h2>Upload Evidence Document</h2>
            <p>
              Computes SHA-256 fingerprint &amp; replicates across Mumbai +
              Singapore.
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            type="button"
            disabled={uploading}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="document-form-label">Select File (Max 10 MB)</label>
          <label className="file-drop-area">
            <Upload size={28} />
            <strong>
              {file ? file.name : "Click to choose evidence file"}
            </strong>
            <span>
              {file ? formatFileSize(file.size) : "PDF, PNG, JPG, JPEG, or TXT"}
            </span>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setValidationError("");
              }}
              disabled={uploading}
            />
          </label>

          <label className="document-form-label">
            Category <span>*</span>
          </label>
          <select
            className="document-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={uploading}
          >
            {DOCUMENT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>

          <label className="document-form-label">Compliance Description</label>
          <textarea
            className="document-input document-textarea"
            placeholder="Audit reference, policy ID, or retention notes..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={uploading}
          />

          {validationError && (
            <p className="document-validation-error">{validationError}</p>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="document-primary-button"
              disabled={uploading}
            >
              <Upload size={16} />
              {uploading ? "Hashing & Uploading..." : "Upload to Vault"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PreviewModal({ document, previewUrl, previewText, onClose }) {
  const isImage = document.contentType?.startsWith("image/");
  const isText = document.contentType?.startsWith("text/");

  return (
    <div className="document-modal-overlay" onClick={onClose}>
      <section
        className="document-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2>{document.originalFilename}</h2>
            <p>Verified SHA-256: {document.sha256Checksum}</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {isImage ? (
          <div className="image-preview-area">
            <img src={previewUrl} alt={document.originalFilename} />
          </div>
        ) : isText ? (
          <pre className="text-preview-area">{previewText}</pre>
        ) : (
          <iframe
            className="pdf-preview-frame"
            src={previewUrl}
            title={document.originalFilename}
          />
        )}
      </section>
    </div>
  );
}

function VersionInspectorModal({
  document,
  canMutate,
  onClose,
  onDocumentChanged,
}) {
  const [s3Versions, setS3Versions] = useState([]);
  const [dbVersions, setDbVersions] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const [integrityReport, setIntegrityReport] = useState(null);
  const [newVersionFile, setNewVersionFile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const loadVersionData = useCallback(async () => {
    setLoading(true);
    setErrMsg("");
    try {
      const [s3List, dbList] = await Promise.all([
        getDocumentVersions(document.id),
        getDocumentVersionHistory(document.id),
      ]);
      setS3Versions(Array.isArray(s3List) ? s3List : []);
      setDbVersions(Array.isArray(dbList) ? dbList : []);
    } catch (err) {
      setErrMsg(err?.message || "Failed to load version metadata.");
    } finally {
      setLoading(false);
    }
  }, [document.id]);

  useEffect(() => {
    loadVersionData();
  }, [loadVersionData]);

  async function handleUploadVersion(e) {
    e.preventDefault();
    if (!newVersionFile) return;
    setBusyAction("upload");
    setErrMsg("");
    setStatusMsg("");
    try {
      await uploadNewDocumentVersion(document.id, newVersionFile);
      setNewVersionFile(null);
      setStatusMsg("New S3 object version uploaded and SHA-256 recorded.");
      await loadVersionData();
      onDocumentChanged();
    } catch (err) {
      setErrMsg(err?.message || "Failed to upload new version.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRestoreVersion(versionId) {
    setBusyAction(versionId);
    setErrMsg("");
    setStatusMsg("");
    try {
      await restoreHistoricalVersion(document.id, versionId);
      setStatusMsg(
        `Version ${versionId.slice(0, 12)}... copied forward as active version.`,
      );
      await loadVersionData();
      onDocumentChanged();
    } catch (err) {
      setErrMsg(err?.message || "Failed to restore historical version.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDownloadVersion(versionId) {
    setBusyAction(`dl-${versionId}`);
    setErrMsg("");
    try {
      const blob = await downloadHistoricalVersion(document.id, versionId);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = `v-${versionId.slice(0, 8)}-${document.originalFilename}`;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setErrMsg(err?.message || "Historical version download failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleReconcile() {
    setBusyAction("reconcile");
    setErrMsg("");
    try {
      const res = await reconcileDocumentVersions(document.id);
      setReconciliation(res);
    } catch (err) {
      setErrMsg(err?.message || "Reconciliation check failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleVerifyIntegrity() {
    setBusyAction("integrity");
    setErrMsg("");
    try {
      const res = await verifyHistoricalVersionIntegrity(document.id);
      setIntegrityReport(res);
    } catch (err) {
      setErrMsg(err?.message || "Historical integrity check failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSimulateCorruption() {
    setBusyAction("corrupt");
    setErrMsg("");
    setStatusMsg("");
    try {
      await simulateDocumentCorruption(document.id);
      setStatusMsg(
        "Checksum drift injected! Next download/preview will trigger 409 Integrity Failure until recovered.",
      );
      onDocumentChanged();
    } catch (err) {
      setErrMsg(err?.message || "Corruption simulation failed.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="document-modal-overlay" onClick={onClose}>
      <section
        className="document-modal version-inspector-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2>Version Chain &amp; Cryptographic Proof</h2>
            <p>
              Document #{document.id} ·{" "}
              <strong>{document.originalFilename}</strong>
            </p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {statusMsg && (
          <div className="document-alert document-alert-success">
            <CheckCircle2 size={16} />
            <span>{statusMsg}</span>
          </div>
        )}
        {errMsg && (
          <div className="document-alert document-alert-error">
            <AlertCircle size={16} />
            <span>{errMsg}</span>
          </div>
        )}

        <div className="inspector-toolbar">
          <button
            type="button"
            className="secondary-button"
            disabled={!!busyAction}
            onClick={handleReconcile}
          >
            <GitCompare size={15} />
            {busyAction === "reconcile"
              ? "Reconciling..."
              : "Reconcile S3 ↔ MySQL"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={!!busyAction}
            onClick={handleVerifyIntegrity}
          >
            <ShieldCheck size={15} />
            {busyAction === "integrity"
              ? "Hashing All Versions..."
              : "Verify All Versions SHA-256"}
          </button>

          {canMutate && document.status === "ACTIVE" && (
            <button
              type="button"
              className="secondary-button danger-outline-button"
              disabled={!!busyAction}
              onClick={handleSimulateCorruption}
            >
              <Bug size={15} />
              {busyAction === "corrupt"
                ? "Injecting..."
                : "Simulate Corruption"}
            </button>
          )}
        </div>

        {reconciliation && (
          <div className="inspector-report-card">
            <div className="report-header">
              <strong>S3 ↔ MySQL Version Reconciliation</strong>
              <span
                className={`document-status ${
                  reconciliation.reconciliationStatus === "CONSISTENT"
                    ? "document-status-active"
                    : "document-status-deleted"
                }`}
              >
                {reconciliation.reconciliationStatus}
              </span>
            </div>
            <p>{reconciliation.message}</p>
            <div className="report-metrics">
              <span>
                S3 Versions: <strong>{reconciliation.s3VersionCount}</strong>
              </span>
              <span>
                MySQL Records:{" "}
                <strong>{reconciliation.databaseVersionCount}</strong>
              </span>
              <span>
                Matched: <strong>{reconciliation.matchedVersionCount}</strong>
              </span>
              <span>
                Delete Markers:{" "}
                <strong>
                  {reconciliation.deleteMarkerVersionIds?.length || 0}
                </strong>
              </span>
            </div>
          </div>
        )}

        {integrityReport && (
          <div className="inspector-report-card">
            <div className="report-header">
              <strong>Deep Historical SHA-256 Verification</strong>
              <span
                className={`document-status ${
                  integrityReport.integrityStatus === "VERIFIED"
                    ? "document-status-active"
                    : "document-status-deleted"
                }`}
              >
                {integrityReport.integrityStatus}
              </span>
            </div>
            <p>{integrityReport.message}</p>
            <div className="report-metrics">
              <span>
                Verified:{" "}
                <strong>
                  {integrityReport.verifiedVersionCount} /{" "}
                  {integrityReport.databaseVersionCount}
                </strong>
              </span>
            </div>
          </div>
        )}

        {canMutate && document.status === "ACTIVE" && (
          <form className="new-version-form" onSubmit={handleUploadVersion}>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              onChange={(e) => setNewVersionFile(e.target.files?.[0] || null)}
              disabled={!!busyAction}
            />
            <button
              type="submit"
              className="document-primary-button"
              disabled={!newVersionFile || !!busyAction}
            >
              <Upload size={15} />
              {busyAction === "upload" ? "Uploading..." : "Upload New Version"}
            </button>
          </form>
        )}

        <h3 className="inspector-section-title">
          S3 Object Versions &amp; Delete Markers
        </h3>
        {loading ? (
          <div className="documents-empty-state">
            <RefreshCw className="documents-spin" size={22} />
            <p>Querying S3 &amp; MySQL version chains...</p>
          </div>
        ) : (
          <div className="documents-table-scroll">
            <table className="documents-table inspector-table">
              <thead>
                <tr>
                  <th>S3 Version ID</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>SHA-256 Digest</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {s3Versions.map((ver) => {
                  const dbMatch = dbVersions.find(
                    (d) => d.s3VersionId === ver.versionId,
                  );
                  return (
                    <tr key={ver.versionId}>
                      <td className="checksum-value" title={ver.versionId}>
                        {ver.versionId.slice(0, 16)}...
                        {ver.latest && (
                          <span className="latest-pill">LATEST</span>
                        )}
                      </td>
                      <td>
                        {ver.deleteMarker ? (
                          <span className="document-status document-status-deleted">
                            DELETE MARKER
                          </span>
                        ) : (
                          <span className="document-status document-status-active">
                            DATA OBJECT
                          </span>
                        )}
                      </td>
                      <td>
                        {ver.deleteMarker ? "—" : formatFileSize(ver.sizeBytes)}
                      </td>
                      <td
                        className="checksum-value"
                        title={dbMatch?.sha256Checksum}
                      >
                        {dbMatch?.sha256Checksum
                          ? `${dbMatch.sha256Checksum.slice(0, 14)}...`
                          : "—"}
                      </td>
                      <td>{formatDocumentDate(ver.lastModified)}</td>
                      <td>
                        {!ver.deleteMarker && (
                          <div className="document-row-actions">
                            <button
                              title="Download this version"
                              disabled={!!busyAction}
                              onClick={() =>
                                handleDownloadVersion(ver.versionId)
                              }
                            >
                              <Download size={15} />
                            </button>
                            {canMutate && (
                              <button
                                title="Promote / Restore this version"
                                className="restore-action"
                                disabled={!!busyAction}
                                onClick={() =>
                                  handleRestoreVersion(ver.versionId)
                                }
                              >
                                <RotateCcw size={15} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Documents() {
  const { hasRole } = useAuth();
  const canMutate = hasRole([USER_ROLES.ADMIN, USER_ROLES.OPERATOR]);

  const [activeTab, setActiveTab] = useState("ALL"); // "ALL" | "TRASH"
  const [viewMode, setViewMode] = useState("CARDS"); // "CARDS" | "TABLE"

  const [documents, setDocuments] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionId, setActionId] = useState(null);

  const [showUpload, setShowUpload] = useState(false);
  const [selectedPreviewDocument, setSelectedPreviewDocument] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [inspectorDocument, setInspectorDocument] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const effectiveStatus = activeTab === "TRASH" ? "DELETED" : status;

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await getDocuments({
        keyword,
        category,
        status: effectiveStatus,
        page,
        size: PAGE_SIZE,
      });

      setDocuments(Array.isArray(result?.content) ? result.content : []);
      setTotalPages(result?.totalPages ?? 0);
      setTotalElements(result?.totalElements ?? 0);
    } catch (err) {
      setError(err?.message || "Unable to load documents.");
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, category, effectiveStatus, page]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Visualizations derived from current vault view
  const categoryChartData = useMemo(() => {
    const counts = {};
    documents.forEach((doc) => {
      const cat = doc.category || "OTHER";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [documents]);

  const statusChartData = useMemo(() => {
    let active = 0;
    let deleted = 0;
    let corrupted = 0;
    documents.forEach((doc) => {
      const st = getDocumentStatus(doc.status);
      if (st === "ACTIVE") active++;
      else if (st === "DELETED") deleted++;
      else if (st === "CORRUPTED") corrupted++;
    });
    return [
      { name: "Active", value: active, color: "#22c55e" },
      { name: "Deleted (Retained)", value: deleted, color: "#f59e0b" },
      { name: "Corrupted", value: corrupted, color: "#ef4444" },
    ].filter((d) => d.value > 0);
  }, [documents]);

  async function handleUpload(file, selectedCategory, description) {
    setUploading(true);
    setError("");
    setMessage("");
    try {
      await uploadDocument(file, selectedCategory, description);
      setShowUpload(false);
      setActiveTab("ALL");
      setPage(0);
      setMessage("Evidence uploaded, SHA-256 recorded, and versioned in S3.");
      await loadDocuments();
    } catch (err) {
      setError(err?.message || "Document upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc) {
    setActionId(doc.id);
    setError("");
    try {
      const blob = await downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = doc.originalFilename || "document";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(
        err?.message || "Integrity verification failed during download.",
      );
      await loadDocuments();
    } finally {
      setActionId(null);
    }
  }

  async function handlePreview(doc) {
    if (!isPreviewable(doc.contentType, doc.originalFilename)) {
      setError("Preview is supported for PDF, TXT, and image files.");
      return;
    }
    setActionId(doc.id);
    setError("");
    try {
      const blob = await previewDocument(doc.id);
      if (doc.contentType?.startsWith("text/")) {
        const text = await blob.text();
        setPreviewText(text);
        setPreviewUrl("");
      } else {
        setPreviewText("");
        setPreviewUrl(URL.createObjectURL(blob));
      }
      setSelectedPreviewDocument(doc);
    } catch (err) {
      setError(err?.message || "Unable to preview document.");
      await loadDocuments();
    } finally {
      setActionId(null);
    }
  }

  function closePreview() {
    setSelectedPreviewDocument(null);
    setPreviewUrl("");
    setPreviewText("");
  }

  async function handleDelete(doc) {
    const confirmed = window.confirm(
      `Move "${doc.originalFilename}" to Recently Deleted? An S3 Delete Marker will be created while retaining historical versions.`,
    );
    if (!confirmed) return;

    setActionId(doc.id);
    setError("");
    setMessage("");
    try {
      await deleteDocument(doc.id);
      setMessage(
        "S3 Delete Marker created. Moved to Recently Deleted (versions retained).",
      );
      await loadDocuments();
    } catch (err) {
      setError(err?.message || "Unable to delete document.");
    } finally {
      setActionId(null);
    }
  }

  async function handleRestore(doc) {
    setActionId(doc.id);
    setError("");
    setMessage("");
    try {
      await restoreDocument(doc.id);
      setMessage("Document recovered from retained S3 version and verified.");
      await loadDocuments();
    } catch (err) {
      setError(err?.message || "Unable to restore document.");
    } finally {
      setActionId(null);
    }
  }

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">
            EVIDENCE VAULT &amp; RETENTION
          </span>
          <h1>Document Evidence Vault</h1>
          <p>
            Manage compliance evidence, inspect S3 version chains, verify
            SHA-256 digests, and recover deleted objects.
          </p>
        </div>

        <div className="heading-action-group">
          <div
            className="view-toggle-group"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "CARDS" ? "active" : ""}`}
              onClick={() => setViewMode("CARDS")}
            >
              <LayoutGrid size={15} />
              Cards
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "TABLE" ? "active" : ""}`}
              onClick={() => setViewMode("TABLE")}
            >
              <List size={15} />
              Table
            </button>
          </div>

          {canMutate && (
            <button
              className="document-primary-button"
              onClick={() => setShowUpload(true)}
            >
              <Upload size={17} />
              Upload Evidence
            </button>
          )}
        </div>
      </section>

      {/* Vault Tabs: All Vault vs Recently Deleted */}
      <div className="vault-tabs-bar">
        <button
          type="button"
          className={`vault-tab ${activeTab === "ALL" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("ALL");
            setPage(0);
          }}
        >
          <FolderOpen size={16} />
          All Vault Documents
        </button>

        <button
          type="button"
          className={`vault-tab ${activeTab === "TRASH" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("TRASH");
            setPage(0);
          }}
        >
          <ArchiveRestore size={16} />
          Recently Deleted (S3 Retained Versions)
        </button>
      </div>

      {/* Visual Insights Row */}
      {documents.length > 0 && (
        <section className="vault-visuals-grid">
          <div className="vault-chart-card">
            <h3>Evidence by Category</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={categoryChartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(148,163,184,0.15)"
                />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  width={30}
                />
                <Tooltip />
                <Bar dataKey="count" fill="#38bdf8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="vault-chart-card">
            <h3>Integrity &amp; Retention Health</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={68}
                  paddingAngle={4}
                >
                  {statusChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Alerts */}
      {message && (
        <div className="document-alert document-alert-success">
          <CheckCircle2 size={17} />
          <span>{message}</span>
          <button onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="document-alert document-alert-error">
          <ShieldAlert size={17} />
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Search & Filters */}
      <section className="document-toolbar">
        <form
          className="document-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            loadDocuments();
          }}
        >
          <div className="document-search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search document filename..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          <select
            className="document-filter-input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>

          {activeTab === "ALL" && (
            <select
              className="document-filter-input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DELETED">Deleted</option>
              <option value="CORRUPTED">Corrupted</option>
            </select>
          )}

          <button type="submit" className="document-search-button">
            Search
          </button>

          <button
            type="button"
            className="document-clear-button"
            onClick={() => {
              setKeyword("");
              setCategory("");
              setStatus("");
              setPage(0);
            }}
          >
            Clear
          </button>
        </form>

        <button
          className="document-refresh-button"
          onClick={loadDocuments}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "documents-spin" : ""} />
        </button>
      </section>

      {/* Main Content: Card Grid OR Data Table */}
      {loading ? (
        <div className="documents-empty-state">
          <RefreshCw className="documents-spin" size={26} />
          <p>Loading evidence vault...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="documents-empty-state">
          <FolderOpen size={36} />
          <h3>
            {activeTab === "TRASH"
              ? "No soft-deleted documents in retention"
              : "No evidence documents found"}
          </h3>
          <p>
            {activeTab === "TRASH"
              ? "Deleted files appear here with their S3 Delete Markers so operators can restore them anytime."
              : "Upload a PDF, image, or text file to generate a SHA-256 hash and S3 version."}
          </p>
        </div>
      ) : viewMode === "CARDS" ? (
        <section className="evidence-cards-grid">
          {documents.map((doc) => {
            const deleted = getDocumentStatus(doc.status) === "DELETED";
            return (
              <article key={doc.id} className="evidence-card">
                <div className="evidence-card-top">
                  <div className="document-file-icon">
                    <DocumentIcon contentType={doc.contentType} />
                  </div>
                  <div className="evidence-card-title">
                    <span className="evidence-id-tag">
                      #{doc.id} · {doc.category}
                    </span>
                    <h3 title={doc.originalFilename}>{doc.originalFilename}</h3>
                  </div>
                  <DocumentStatusBadge status={doc.status} />
                </div>

                {doc.description && (
                  <p className="evidence-card-desc">{doc.description}</p>
                )}

                <div className="evidence-card-meta">
                  <div>
                    <span>Size</span>
                    <strong>{formatFileSize(doc.fileSizeBytes)}</strong>
                  </div>
                  <div>
                    <span>Uploaded By</span>
                    <strong>{doc.uploadedBy || "N/A"}</strong>
                  </div>
                  <div>
                    <span>SHA-256 Digest</span>
                    <code title={doc.sha256Checksum}>
                      {doc.sha256Checksum
                        ? `${doc.sha256Checksum.slice(0, 14)}...`
                        : "N/A"}
                    </code>
                  </div>
                </div>

                <div className="evidence-card-footer">
                  <button
                    className="card-action-btn"
                    onClick={() => setInspectorDocument(doc)}
                    title="Inspect S3 Versions & Integrity"
                  >
                    <Layers size={14} /> Versions
                  </button>

                  {!deleted ? (
                    <>
                      <button
                        className="card-action-btn"
                        disabled={
                          actionId === doc.id ||
                          !isPreviewable(doc.contentType, doc.originalFilename)
                        }
                        onClick={() => handlePreview(doc)}
                      >
                        <Eye size={14} /> Preview
                      </button>

                      <button
                        className="card-action-btn"
                        disabled={actionId === doc.id}
                        onClick={() => handleDownload(doc)}
                      >
                        <Download size={14} /> Download
                      </button>

                      {canMutate && (
                        <button
                          className="card-action-btn danger"
                          disabled={actionId === doc.id}
                          onClick={() => handleDelete(doc)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    canMutate && (
                      <button
                        className="card-action-btn restore"
                        disabled={actionId === doc.id}
                        onClick={() => handleRestore(doc)}
                      >
                        <RotateCcw size={14} /> Restore Object
                      </button>
                    )
                  )}
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
                  <th>ID</th>
                  <th>Document</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>SHA-256 Checksum</th>
                  <th>Status</th>
                  <th>Uploaded by</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const deleted = getDocumentStatus(doc.status) === "DELETED";
                  return (
                    <tr key={doc.id}>
                      <td>#{doc.id}</td>
                      <td>
                        <div className="document-name-cell">
                          <div className="document-file-icon">
                            <DocumentIcon contentType={doc.contentType} />
                          </div>
                          <div>
                            <strong>{doc.originalFilename}</strong>
                            <span>
                              {getFileExtension(doc.originalFilename)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>{doc.category || "N/A"}</td>
                      <td>{formatFileSize(doc.fileSizeBytes)}</td>
                      <td>
                        <span
                          className="checksum-value"
                          title={doc.sha256Checksum}
                        >
                          {doc.sha256Checksum
                            ? `${doc.sha256Checksum.slice(0, 12)}...`
                            : "N/A"}
                        </span>
                      </td>
                      <td>
                        <DocumentStatusBadge status={doc.status} />
                      </td>
                      <td>{doc.uploadedBy || "N/A"}</td>
                      <td>{formatDocumentDate(doc.createdAt)}</td>
                      <td>
                        <div className="document-row-actions">
                          <button
                            title="Versions, Reconciliation & Integrity"
                            onClick={() => setInspectorDocument(doc)}
                          >
                            <Layers size={16} />
                          </button>

                          {!deleted && (
                            <>
                              <button
                                title="Preview"
                                disabled={
                                  actionId === doc.id ||
                                  !isPreviewable(
                                    doc.contentType,
                                    doc.originalFilename,
                                  )
                                }
                                onClick={() => handlePreview(doc)}
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                title="Download (SHA-256 Verified)"
                                disabled={actionId === doc.id}
                                onClick={() => handleDownload(doc)}
                              >
                                <Download size={16} />
                              </button>
                              {canMutate && (
                                <button
                                  title="Soft Delete"
                                  className="delete-action"
                                  disabled={actionId === doc.id}
                                  onClick={() => handleDelete(doc)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </>
                          )}

                          {deleted && canMutate && (
                            <button
                              title="Restore Deleted Document"
                              className="restore-action"
                              disabled={actionId === doc.id}
                              onClick={() => handleRestore(doc)}
                            >
                              <RotateCcw size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pagination */}
      <div className="documents-pagination">
        <span>
          Page {totalPages ? page + 1 : 0} of {totalPages} ({totalElements}{" "}
          total records)
        </span>
        <div>
          <button
            disabled={page <= 0 || loading}
            onClick={() => setPage((c) => c - 1)}
          >
            <ChevronLeft size={17} /> Previous
          </button>
          <button
            disabled={page >= totalPages - 1 || loading}
            onClick={() => setPage((c) => c + 1)}
          >
            Next <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUpload={handleUpload}
          uploading={uploading}
        />
      )}

      {selectedPreviewDocument && (
        <PreviewModal
          document={selectedPreviewDocument}
          previewUrl={previewUrl}
          previewText={previewText}
          onClose={closePreview}
        />
      )}

      {inspectorDocument && (
        <VersionInspectorModal
          document={inspectorDocument}
          canMutate={canMutate}
          onClose={() => setInspectorDocument(null)}
          onDocumentChanged={loadDocuments}
        />
      )}
    </main>
  );
}
