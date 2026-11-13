import { apiRequest } from "./api";
import { APP_CONFIG } from "../config/constants";

const DOCUMENTS_ENDPOINT = "/v1/documents";
const API_BASE_URL = APP_CONFIG.API_BASE_URL;

export async function getDocuments({
  keyword = "",
  category = "",
  status = "",
  page = 0,
  size = 10,
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });

  if (keyword.trim()) params.set("keyword", keyword.trim());
  if (category.trim()) params.set("category", category.trim());
  if (status.trim()) params.set("status", status.trim());

  return apiRequest(`${DOCUMENTS_ENDPOINT}?${params.toString()}`);
}

export async function uploadDocument(file, category, description) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  if (description && description.trim()) {
    formData.append("description", description.trim());
  }

  return apiRequest(`${DOCUMENTS_ENDPOINT}/upload`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteDocument(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}`, {
    method: "DELETE",
  });
}

export async function restoreDocument(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/restore`, {
    method: "POST",
  });
}

export async function simulateDocumentCorruption(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/simulate-corruption`, {
    method: "POST",
  });
}

// --- Version Management & Integrity APIs ---

export async function getDocumentVersions(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/versions`);
}

export async function getDocumentVersionHistory(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/version-history`);
}

export async function uploadNewDocumentVersion(documentId, file) {
  const formData = new FormData();
  formData.append("file", file);

  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/versions`, {
    method: "POST",
    body: formData,
  });
}

export async function restoreHistoricalVersion(documentId, versionId) {
  return apiRequest(
    `${DOCUMENTS_ENDPOINT}/${documentId}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: "POST" },
  );
}

export async function reconcileDocumentVersions(documentId) {
  return apiRequest(
    `${DOCUMENTS_ENDPOINT}/${documentId}/version-reconciliation`,
  );
}

export async function verifyHistoricalVersionIntegrity(documentId) {
  return apiRequest(`${DOCUMENTS_ENDPOINT}/${documentId}/version-integrity`);
}

// --- Binary Downloads & Previews ---

async function fetchBinaryBlob(path, fallbackMessage) {
  const token = localStorage.getItem("evidence-vault-token");

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let message = fallbackMessage;

    try {
      const data = await response.json();
      message = data.detail || data.message || data.error || message;
    } catch {
      // Keep fallback message
    }

    throw new Error(message);
  }

  return response.blob();
}

export function downloadDocument(documentId) {
  return fetchBinaryBlob(
    `${DOCUMENTS_ENDPOINT}/${documentId}/download`,
    "Unable to download document (possible integrity failure or access denial).",
  );
}

export function previewDocument(documentId) {
  return fetchBinaryBlob(
    `${DOCUMENTS_ENDPOINT}/${documentId}/preview`,
    "Unable to preview document.",
  );
}

export function downloadHistoricalVersion(documentId, versionId) {
  return fetchBinaryBlob(
    `${DOCUMENTS_ENDPOINT}/${documentId}/versions/${encodeURIComponent(versionId)}/download`,
    "Unable to download historical version.",
  );
}
