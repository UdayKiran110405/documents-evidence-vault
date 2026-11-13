function StatusBadge({ status }) {
  const normalizedStatus = String(status || "UNKNOWN").toUpperCase();

  const isHealthy = [
    "UP",
    "SUCCESS",
    "COMPLETED",
    "HEALTHY",
    "RUNNING",
  ].includes(normalizedStatus);

  const isWarning = ["NOT_CHECKED", "PENDING", "IN_PROGRESS"].includes(
    normalizedStatus,
  );

  const color = isHealthy ? "success" : isWarning ? "warning" : "danger";

  return (
    <span className={`status-badge ${color}`}>
      <span className="status-indicator"></span>
      {normalizedStatus.replaceAll("_", " ")}
    </span>
  );
}

export default StatusBadge;
