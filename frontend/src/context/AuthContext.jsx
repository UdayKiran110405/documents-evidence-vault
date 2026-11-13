import { createContext, useContext, useEffect, useState } from "react";

import {
  loginUser,
  saveAuthSession,
  getStoredUser,
  clearAuthSession,
} from "../services/authService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());

  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    Boolean(localStorage.getItem("evidence-vault-token") && getStoredUser()),
  );

  const [loading, setLoading] = useState(false);

  // Restore the saved session on application startup.
  useEffect(() => {
    const storedUser = getStoredUser();
    const storedToken = localStorage.getItem("evidence-vault-token");

    if (storedUser && storedToken) {
      setUser(storedUser);
      setIsAuthenticated(true);
    } else {
      clearAuthSession();
      setUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  const login = async (credentials) => {
    setLoading(true);

    try {
      const authData = await loginUser(credentials);

      if (!authData?.accessToken) {
        throw new Error("Authentication token was not received.");
      }

      saveAuthSession(authData);

      setUser({
        username: authData.username,
        roles: authData.roles || [],
        tokenType: authData.tokenType,
        expiresIn: authData.expiresIn,
      });

      setIsAuthenticated(true);

      return authData;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearAuthSession();

    setUser(null);
    setIsAuthenticated(false);
  };

  const hasRole = (allowedRoles = []) => {
    if (!user || !Array.isArray(user.roles)) {
      return false;
    }

    return allowedRoles.some((role) => user.roles.includes(role));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        loading,
        login,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
