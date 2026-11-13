export function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) {
    return "N/A";
  }

  const size = Number(bytes);

  if (!Number.isFinite(size) || size < 0) {
    return "N/A";
  }

  if (size === 0) {
    return "0 Bytes";
  }

  const units = ["Bytes", "KB", "MB", "GB", "TB"];

  const index = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );

  return `${(size / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

export function formatDocumentDate(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleString();
}

export function getFileExtension(filename = "") {
  if (!filename || !filename.includes(".")) {
    return "FILE";
  }

  return filename.split(".").pop().toUpperCase();
}

export function getNormalizedContentType(contentType = "") {
  return String(contentType).toLowerCase().split(";")[0].trim();
}

export function isTextDocument(contentType = "", filename = "") {
  const type = getNormalizedContentType(contentType);

  const extension = String(filename).toLowerCase().split(".").pop();

  const textExtensions = ["txt", "csv", "json", "xml", "log", "md"];

  return (
    type.startsWith("text/") ||
    ["application/json", "application/xml"].includes(type) ||
    textExtensions.includes(extension)
  );
}

export function isPreviewable(contentType = "", filename = "") {
  const type = getNormalizedContentType(contentType);

  const extension = String(filename).toLowerCase().split(".").pop();

  const supportedTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ];

  const supportedExtensions = [
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "txt",
    "csv",
    "json",
    "xml",
    "log",
    "md",
  ];

  return (
    supportedTypes.includes(type) ||
    type.startsWith("image/") ||
    isTextDocument(type, filename) ||
    supportedExtensions.includes(extension)
  );
}

export function getDocumentStatus(status) {
  return String(status || "UNKNOWN").toUpperCase();
}
