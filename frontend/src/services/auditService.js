import { apiRequest } from "./api";

export async function getDocumentAuditHistory(documentId) {
  if (!documentId) {
    throw new Error("Please select a document.");
  }

  return apiRequest(`/v1/audit/documents/${documentId}`);
}
