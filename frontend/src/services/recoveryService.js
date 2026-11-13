import { apiRequest } from "./api";

export function verifyMultiRegionDocument(documentId) {
  return apiRequest(`/v1/dr/verify/${documentId}`, { method: "POST" });
}

export function recoverMultiRegionDocument(documentId, versionId = null) {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
  return apiRequest(`/v1/dr/recover/${documentId}${query}`, { method: "POST" });
}

export function runAutomatedDrill(documentId) {
  return apiRequest(`/v1/dr/drills/run/${documentId}`, { method: "POST" });
}

export function simulatePrimaryFailureDrill(documentId) {
  return apiRequest(`/v1/dr/drills/simulate-primary-failure/${documentId}`, {
    method: "POST",
  });
}

export function simulateCorruptionDrill(documentId) {
  return apiRequest(`/v1/dr/drills/simulate-corruption/${documentId}`, {
    method: "POST",
  });
}

export function syncToSnowflakeWarehouse() {
  return apiRequest("/v1/dr/snowflake-sync", { method: "POST" });
}

export function getDrillHistory() {
  return apiRequest("/v1/dr/drills");
}

export function getRecoveryManifests() {
  return apiRequest("/v1/dr/manifests");
}

export function getDrMetrics() {
  return apiRequest("/v1/dr/metrics");
}

export function getAllAuditLogs() {
  return apiRequest("/v1/audit");
}

export function getDocumentAuditLogs(documentId) {
  return apiRequest(`/v1/audit/documents/${documentId}`);
}
