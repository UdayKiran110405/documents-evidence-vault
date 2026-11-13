import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Info,
  FileText,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { USER_ROLES } from "../config/constants";
import { getDocuments, restoreDocument } from "../services/documentService";
import { formatDocumentDate, formatFileSize } from "../services/documentUtils";

import "../styles/documents.css";

export default function TrashVault() {
  const { hasRole } = useAuth();
  const canMutate = hasRole([USER_ROLES.ADMIN, USER_ROLES.OPERATOR]);

  const [deletedDocs, setDeletedDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadDeleted = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getDocuments({ status: "DELETED", page: 0, size: 50 });
      setDeletedDocs(Array.isArray(res?.content) ? res.content : []);
    } catch (err) {
      setError(err?.message || "Failed to load retained deleted documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeleted();
  }, [loadDeleted]);

  async function handleRestore(doc) {
    setRestoringId(doc.id);
    setError("");
    setMessage("");
    try {
      await restoreDocument(doc.id);
      setMessage(
        `Recovered "${doc.originalFilename}" from retained S3 version and verified SHA-256 integrity.`,
      );
      await loadDeleted();
    } catch (err) {
      setError(err?.message || "Restore failed.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <main className="documents-page">
      <section className="documents-heading">
        <div>
          <span className="documents-eyebrow">
            S3 DELETE MARKER &amp; RETENTION PROTECTION
          </span>
          <h1>Retention &amp; Trash Vault</h1>
          <p>
            Soft-deleted documents remain protected in S3 via version retention
            and can be restored anytime.
          </p>
        </div>

        <button
          className="document-primary-button"
          onClick={loadDeleted}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "documents-spin" : ""} />
          Refresh Vault
        </button>
      </section>

      <div className="explainer-banner">
        <Info size={20} />
        <div>
          <strong>How S3 Delete Markers Prevent Permanent Data Loss:</strong>{" "}
          When an operator deletes a document, EvidenceVault places a{" "}
          <strong>Delete Marker</strong> on top of the S3 object rather than
          purging historical versions. Because IAM denies{" "}
          <code>s3:DeleteObjectVersion</code>, prior versions stay intact and
          can be promoted back to <code>ACTIVE</code> with full SHA-256
          verification.
        </div>
      </div>

      {message && (
        <div className="document-alert document-alert-success">
          <CheckCircle2 size={17} />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="document-alert document-alert-error">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="documents-empty-state">
          <RefreshCw className="documents-spin" size={25} />
          <p>Scanning S3 retention markers...</p>
        </div>
      ) : deletedDocs.length === 0 ? (
        <div className="documents-empty-state">
          <ShieldCheck size={36} />
          <h3>Retention Vault is Clear</h3>
          <p>
            No soft-deleted documents are currently awaiting recovery. Delete
            any document from Evidence Vault to simulate accidental deletion.
          </p>
        </div>
      ) : (
        <section className="evidence-cards-grid">
          {deletedDocs.map((doc) => (
            <article key={doc.id} className="evidence-card">
              <div className="evidence-card-top">
                <div className="document-file-icon">
                  <FileText size={20} />
                </div>
                <div className="evidence-card-title">
                  <span className="evidence-id-tag">
                    #{doc.id} · {doc.category}
                  </span>
                  <h3 title={doc.originalFilename}>{doc.originalFilename}</h3>
                </div>
                <span className="document-status document-status-deleted">
                  DELETE MARKER
                </span>
              </div>

              <div className="evidence-card-meta">
                <div>
                  <span>Retained Size</span>
                  <strong>{formatFileSize(doc.fileSizeBytes)}</strong>
                </div>
                <div>
                  <span>Deleted Date</span>
                  <strong>{formatDocumentDate(doc.createdAt)}</strong>
                </div>
                <div>
                  <span>Protected SHA-256 Digest</span>
                  <code>{doc.sha256Checksum?.slice(0, 22)}...</code>
                </div>
              </div>

              <div className="evidence-card-footer">
                {canMutate ? (
                  <button
                    className="card-action-btn restore"
                    disabled={restoringId === doc.id}
                    onClick={() => handleRestore(doc)}
                  >
                    <ArchiveRestore size={15} />
                    {restoringId === doc.id
                      ? "Recovering & Verifying..."
                      : "Recover from S3 Version"}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Auditor read-only view (Restore requires Operator/Admin)
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
