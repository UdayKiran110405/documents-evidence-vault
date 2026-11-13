import { NavLink, Link } from "react-router-dom";
import { ShieldCheck, PanelLeftClose, PanelLeftOpen, Home } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { SIDEBAR_GROUPS } from "../data/navigation";

export default function Sidebar({ collapsed, onToggle }) {
  const { isAuthenticated, hasRole } = useAuth();

  return (
    <aside className={`ev-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="ev-sidebar-header">
        {!collapsed && (
          <Link to="/" className="ev-sidebar-brand" title="EvidenceVault Home">
            <div className="ev-brand-badge">
              <ShieldCheck size={20} />
            </div>
            <div className="ev-brand-text">
              <strong>EvidenceVault</strong>
              <span>SECURE VAULT</span>
            </div>
          </Link>
        )}

        <button
          type="button"
          className="ev-collapse-btn"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label="Toggle sidebar"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>

      <div className="ev-sidebar-scroll">
        <div className="ev-nav-group">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `ev-nav-item ${isActive ? "active" : ""}`
            }
            title="Overview"
          >
            <Home size={18} />
            {!collapsed && <span>Overview</span>}
          </NavLink>
        </div>

        {isAuthenticated &&
          SIDEBAR_GROUPS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.roles || hasRole(item.roles),
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.group} className="ev-nav-group">
                {!collapsed && (
                  <div className="ev-group-label">{section.group}</div>
                )}

                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `ev-nav-item ${isActive ? "active" : ""}`
                      }
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon size={18} />
                      {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
      </div>

      {!collapsed && (
        <div className="ev-sidebar-footer">
          <div className="ev-region-pill">
            <span className="dot-live" />
            <div>
              <strong>ap-south-1</strong>
              <small>Primary (Mumbai)</small>
            </div>
          </div>
          <div className="ev-region-pill">
            <span className="dot-sync" />
            <div>
              <strong>ap-southeast-1</strong>
              <small>Replica (Singapore)</small>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
