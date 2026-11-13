import { useState } from "react";
import { Outlet } from "react-router-dom";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import Footer from "./Footer";

import "../styles/shell.css";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="ev-shell">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="ev-shell-main">
        <Topbar />

        <main className="main-content">
          <Outlet />
        </main>

        <Footer />
      </div>
    </div>
  );
}
