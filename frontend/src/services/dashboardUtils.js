export function normalizeArray(data) {
  return Array.isArray(data) ? data : [];
}
export function average(values) {
  const valid = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);

  if (!valid.length) return null;

  return Number(
    (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(3),
  );
}

export function calculateDrillSummary(drills) {
  const total = drills.length;

  const successful = drills.filter(
    (item) => item.drill_status === "SUCCESS",
  ).length;

  const failed = drills.filter((item) => item.drill_status === "FAILED").length;

  const attentionRequired = drills.filter(
    (item) => item.drill_status === "RECOVERY_REQUIRED",
  ).length;

  const recoveryOperations = drills.filter(
    (item) => item.recovery_performed === true,
  ).length;

  const corruptionDrills = drills.filter(
    (item) =>
      item.corruption_detected === true ||
      item.failure_type === "SIMULATED_CORRUPTION",
  ).length;

  const primaryFailures = drills.filter(
    (item) => item.failure_type === "SIMULATED_PRIMARY_FAILURE",
  ).length;

  const checksumMismatches = drills.filter((item) => {
    const primaryMismatch =
      item.primary_checksum &&
      item.expected_checksum &&
      item.primary_checksum !== item.expected_checksum;

    const secondaryMismatch =
      item.secondary_checksum &&
      item.expected_checksum &&
      item.secondary_checksum !== item.expected_checksum;

    return primaryMismatch || secondaryMismatch;
  }).length;

  return {
    total,
    successful,
    failed,
    attentionRequired,
    recoveryOperations,
    corruptionDrills,
    primaryFailures,
    checksumMismatches,

    successRate: total ? Number(((successful / total) * 100).toFixed(1)) : null,
  };
}

export function calculateMetricSummary(metrics) {
  const rtoValues = metrics.map(
    (item) => item.recovery_rto_seconds ?? item.recovery_workflow_seconds,
  );

  const rpoValues = metrics
    .map((item) => item.estimated_rpo_seconds)
    .filter((value) => value !== null && value !== undefined);

  const replicationCompleted = metrics.filter(
    (item) => item.replication_status === "COMPLETED",
  ).length;

  const replicationFailed = metrics.filter(
    (item) => item.replication_status === "FAILED",
  ).length;

  const replicationTimedOut = metrics.filter(
    (item) => item.replication_timed_out === true,
  ).length;

  return {
    averageRto: average(rtoValues),
    averageRpo: average(rpoValues),
    replicationCompleted,
    replicationFailed,
    replicationTimedOut,
  };
}

export function getLatestRecord(records) {
  if (!records.length) return null;

  return [...records].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  )[0];
}

export function formatSeconds(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "N/A";
  }

  return `${Number(value).toFixed(3)} sec`;
}

export function formatPercentage(value) {
  return value === null || value === undefined ? "N/A" : `${value}%`;
}

export function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleString();
}
