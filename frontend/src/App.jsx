import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { USER_ROLES, ROUTES } from "./config/constants";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import TrashVault from "./pages/TrashVault";
import Recovery from "./pages/Recovery";
import MultiRegionMonitor from "./pages/MultiRegionMonitor";
import Audit from "./pages/Audit";
import AccessControl from "./pages/AccessControl";
import AnalyticsHub from "./pages/AnalyticsHub";
import Unauthorized from "./pages/Unauthorized";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              {/* Public routes */}
              <Route path={ROUTES.HOME} element={<Home />} />
              <Route path={ROUTES.LOGIN} element={<Login />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* All authenticated roles */}
              <Route element={<ProtectedRoute />}>
                <Route path={ROUTES.DASHBOARD} element={<Dashboard />} />
                <Route path={ROUTES.DOCUMENTS} element={<Documents />} />
                <Route path={ROUTES.TRASH} element={<TrashVault />} />
                <Route
                  path={ROUTES.REPLICATION}
                  element={<MultiRegionMonitor />}
                />
                <Route
                  path={ROUTES.ACCESS_CONTROL}
                  element={<AccessControl />}
                />
              </Route>

              {/* Admin & Operator */}
              <Route
                element={
                  <ProtectedRoute
                    allowedRoles={[USER_ROLES.ADMIN, USER_ROLES.OPERATOR]}
                  />
                }
              >
                <Route path={ROUTES.RECOVERY} element={<Recovery />} />
              </Route>

              {/* Admin & Auditor */}
              <Route
                element={
                  <ProtectedRoute
                    allowedRoles={[USER_ROLES.ADMIN, USER_ROLES.AUDITOR]}
                  />
                }
              >
                <Route path={ROUTES.AUDIT} element={<Audit />} />
                <Route path={ROUTES.ANALYTICS} element={<AnalyticsHub />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
