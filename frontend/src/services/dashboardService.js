import { apiRequest } from "./api";

const DOCUMENTS_ENDPOINT = "/v1/documents";

async function getDocumentPage({ status = "", size = 8 } = {}) {
  const params = new URLSearchParams({
    page: "0",
    size: String(size),
  });

  if (status) {
    params.set("status", status);
  }

  return apiRequest(`${DOCUMENTS_ENDPOINT}?${params.toString()}`);
}

export async function getSystemStatus() {
  return apiRequest("/v1/system/status");
}

export async function getRecoveryMetrics() {
  return apiRequest("/v1/dr/metrics");
}

export async function getDrillHistory() {
  return apiRequest("/v1/dr/drills");
}

export async function getRecoveryManifests() {
  return apiRequest("/v1/dr/manifests");
}

function getSettledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function getSettledError(result) {
  return result.status === "rejected"
    ? result.reason?.message || "Unable to load this information."
    : null;
}

function extractTotal(pageObj) {
  if (!pageObj) return 0;
  return (
    pageObj.page?.totalElements ??
    pageObj.totalElements ??
    (Array.isArray(pageObj.content) ? pageObj.content.length : 0)
  );
}

export async function getDashboardData({ includeRecoveryData = true } = {}) {
  const requests = await Promise.allSettled([
    getSystemStatus(),
    getDocumentPage({ size: 8 }),
    getDocumentPage({ status: "ACTIVE", size: 1 }),
    getDocumentPage({ status: "DELETED", size: 1 }),
    getDocumentPage({ status: "CORRUPTED", size: 1 }),

    includeRecoveryData ? getRecoveryMetrics() : Promise.resolve([]),
    includeRecoveryData ? getDrillHistory() : Promise.resolve([]),
    includeRecoveryData ? getRecoveryManifests() : Promise.resolve([]),
  ]);

  const [
    systemResult,
    recentDocumentsResult,
    activeDocumentsResult,
    deletedDocumentsResult,
    corruptedDocumentsResult,
    metricsResult,
    drillsResult,
    manifestsResult,
  ] = requests;

  const recentPage = getSettledValue(recentDocumentsResult, {});
  const activePage = getSettledValue(activeDocumentsResult, {});
  const deletedPage = getSettledValue(deletedDocumentsResult, {});
  const corruptedPage = getSettledValue(corruptedDocumentsResult, {});

  return {
    system: getSettledValue(systemResult, null),

    documents: {
      total: extractTotal(recentPage),
      active: extractTotal(activePage),
      deleted: extractTotal(deletedPage),
      corrupted: extractTotal(corruptedPage),
      recent: Array.isArray(recentPage.content) ? recentPage.content : [],
    },

    metrics: getSettledValue(metricsResult, []),
    drills: getSettledValue(drillsResult, []),
    manifests: getSettledValue(manifestsResult, []),

    errors: {
      system: getSettledError(systemResult),
      documents: getSettledError(recentDocumentsResult),
      activeDocuments: getSettledError(activeDocumentsResult),
      deletedDocuments: getSettledError(deletedDocumentsResult),
      corruptedDocuments: getSettledError(corruptedDocumentsResult),
      metrics: getSettledError(metricsResult),
      drills: getSettledError(drillsResult),
      manifests: getSettledError(manifestsResult),
    },

    recoveryDataEnabled: includeRecoveryData,
  };
}
