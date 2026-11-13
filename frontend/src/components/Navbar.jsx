import { NavLink, Link, useNavigate } from "react-router-dom";

import {
  Sun,
  Moon,
  ShieldCheck,
  LogIn,
  LogOut,
  UserCircle,
} from "lucide-react";

import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";

import { NAVIGATION_ITEMS } from "../data/navigation";

import "../styles/navbar.css";

function Navbar() {
  const { isDark, toggleTheme } = useTheme();

  const { user, isAuthenticated, logout, hasRole } = useAuth();

  const navigate = useNavigate();

  const visibleNavigation = NAVIGATION_ITEMS.filter((item) => {
    if (item.public) {
      return true;
    }

    if (!isAuthenticated) {
      return false;
    }

    if (!item.roles) {
      return true;
    }

    return hasRole(item.roles);
  });

  const handleLogout = () => {
    logout();

    navigate("/", { replace: true });
  };

  return (
    <header className="navbar">
      <Link to="/" className="navbar-brand">
        <div className="brand-icon">
          <ShieldCheck size={23} />
        </div>

        <div className="brand-details">
          <span className="brand-name">EvidenceVault</span>

          <span className="brand-subtitle">SECURE EVIDENCE SYSTEM</span>
        </div>
      </Link>

      <nav className="navbar-links">
        {visibleNavigation.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="navbar-actions">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        {isAuthenticated ? (
          <div className="user-session">
            <div className="user-info">
              <UserCircle size={18} />

              <div className="user-details">
                <span>{user.username}</span>
                <small>{user.roles?.join(", ")}</small>
              </div>
            </div>

            <button
              className="logout-button"
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut size={17} />
              <span>Logout</span>
            </button>
          </div>
        ) : (
          <Link to="/login" className="login-button">
            <LogIn size={17} />
            <span>Sign In</span>
          </Link>
        )}
      </div>
    </header>
  );
}

export default Navbar;
