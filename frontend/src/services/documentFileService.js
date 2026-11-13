import { APP_CONFIG } from "../config/constants";

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

function getFriendlyError(status) {
  switch (status) {
    case 401:
      return "Your session has expired. Please sign in again.";
    case 403:
      return "You don't have permission to access this document.";
    case 404:
      return "The document could not be found.";
    case 500:
      return "The server couldn't retrieve this document. Please try again.";
    default:
      return "Unable to retrieve the document. Please try again.";
  }
}

export async function fetchDocumentBlob(documentId) {
  const token = localStorage.getItem("evidence-vault-token");

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const response = await fetch(
    `${API_BASE_URL}/v1/documents/${documentId}/download`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = getFriendlyError(response.status);

    try {
      const errorData = await response.json();

      // Don't expose raw server exceptions to the UI.
      if (response.status >= 500) {
        message =
          "The server couldn't retrieve this document. Please try again.";
      } else if (response.status === 401 || response.status === 403) {
        message = getFriendlyError(response.status);
      } else if (errorData.message) {
        message = errorData.message;
      }
    } catch {
      // Keep the friendly fallback message.
    }

    throw new Error(message);
  }

  return await response.blob();
}

export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(objectUrl);
}
