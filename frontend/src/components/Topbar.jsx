import { Link, useNavigate } from "react-router-dom";
import { Sun, Moon, LogIn, LogOut, UserCircle } from "lucide-react";

import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";

export default function Topbar() {
  const { isDark, toggleTheme } = useTheme();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/", { replace: true });
  };

  return (
    <header className="ev-topbar">
      <div className="ev-topbar-left">
        <span className="ev-env-badge">MULTI-REGION EVIDENCE VAULT</span>
        <span className="ev-region-tag">
          Mumbai (ap-south-1) ⇄ Singapore (ap-southeast-1)
        </span>
      </div>

      <div className="ev-topbar-right">
        <button
          type="button"
          className="ev-icon-btn"
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {isAuthenticated ? (
          <div className="ev-user-pill">
            <UserCircle size={19} className="ev-user-avatar" />
            <div className="ev-user-meta">
              <strong>{user.username}</strong>
              <span>{user.roles?.[0]?.replace("ROLE_", "") || "USER"}</span>
            </div>
            <button
              type="button"
              className="ev-logout-btn"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut size={15} />
              <span>Logout</span>
            </button>
          </div>
        ) : (
          <Link to="/login" className="ev-signin-btn">
            <LogIn size={16} />
            <span>Sign In</span>
          </Link>
        )}
      </div>
    </header>
  );
}
