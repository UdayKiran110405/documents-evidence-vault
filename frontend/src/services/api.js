
import { APP_CONFIG } from "../config/constants";

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    // Handles application/json and application/problem+json.
    if (contentType.toLowerCase().includes("json")) {
      return await response.json();
    }

    return await response.text();
  } catch {
    return null;
  }
}

function extractMessage(data) {
  if (!data) return "";

  if (typeof data === "string") {
    const trimmed = data.trim();

    // Avoid showing a JSON response as raw text.
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractMessage(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.defaultMessage || item?.message || "";
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof data === "object") {
    const detail = data.detail;

    if (typeof detail === "string") return detail;

    if (Array.isArray(detail)) {
      return extractMessage(detail);
    }

    return (
      data.message ||
      data.error ||
      data.title ||
      ""
    );
  }

  return "";
}

export function createApiErrorMessage(
  response,
  responseData,
  endpoint = "",
  customFallback = ""
) {
  const status = response.status;

  if (status === 401) {
    if (endpoint.includes("/auth/login")) {
      return "Invalid username or password. Please check your credentials and try again.";
    }

    return "Your session has expired. Please sign in again.";
  }

  if (status === 403) {
    return "You do not have permission to perform this action.";
  }

  if (status === 404) {
    return "The requested resource could not be found.";
  }

  if (status === 409) {
    return "This operation cannot be completed because the resource is in its current state.";
  }

  if (status === 413) {
    return "The selected file is too large to upload.";
  }

  if (status === 415) {
    return "This file format is not supported by the server.";
  }

  if (status === 422) {
    return (
      extractMessage(responseData) ||
      "Some of the submitted information is invalid. Please check your inputs."
    );
  }

  if (status >= 500) {
    return (
      customFallback ||
      "The server encountered an error. Please try again later."
    );
  }

  return (
    extractMessage(responseData) ||
    customFallback ||
    "The request could not be completed. Please try again."
  );
}

export async function getApiErrorMessage(
  response,
  fallback = "",
  endpoint = ""
) {
  const responseData = await readResponseBody(response);

  return createApiErrorMessage(
    response,
    responseData,
    endpoint,
    fallback
  );
}

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem("evidence-vault-token");

  const headers = {
    ...options.headers,
  };

  const isFormData = options.body instanceof FormData;

  // JSON requests need Content-Type.
  // FormData must NOT have a manually assigned Content-Type:
  // the browser adds the multipart boundary automatically.
  if (
    options.body !== undefined &&
    !isFormData &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  // Do not attach an old JWT to the login request.
  if (token && !endpoint.includes("/auth/login")) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Unable to connect to the server. Check that the backend is running and try again."
    );
  }

  if (response.status === 204) {
    return null;
  }

  const responseData = await readResponseBody(response);

  if (!response.ok) {
    const message = createApiErrorMessage(
      response,
      responseData,
      endpoint
    );

    throw new Error(message);
  }

  return responseData;
}
  