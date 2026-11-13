import { apiRequest } from "./api";

export async function loginUser(credentials) {
  const response = await apiRequest("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
    }),
  });

  return response;
}

export function saveAuthSession(authData) {
  localStorage.setItem("evidence-vault-token", authData.accessToken);

  localStorage.setItem(
    "evidence-vault-user",
    JSON.stringify({
      username: authData.username,
      roles: authData.roles,
      tokenType: authData.tokenType,
      expiresIn: authData.expiresIn,
    }),
  );
}

export function getStoredUser() {
  const storedUser = localStorage.getItem("evidence-vault-user");

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch {
    clearAuthSession();
    return null;
  }
}

export function clearAuthSession() {
  localStorage.removeItem("evidence-vault-token");
  localStorage.removeItem("evidence-vault-user");
}
