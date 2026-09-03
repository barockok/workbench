import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Connect from "./pages/Connect";
import BrowserView from "./pages/BrowserView";

function Boot({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-loading">
      <span>{label}…</span>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const dest = location.pathname + location.search;

  // SSO always returns to the portal root, so remember where the human was
  // headed. A connect link is useless if login drops them on the dashboard.
  // This is a side effect, so it runs in an effect, not during render.
  useEffect(() => {
    if (!isLoading && !user) {
      sessionStorage.setItem("awb_return_to", dest);
    }
  }, [isLoading, user, dest]);

  if (isLoading) return <Boot label="Verifying session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/connect/:integration" element={<RequireAuth><Connect /></RequireAuth>} />
      <Route path="/browser" element={<RequireAuth><BrowserView /></RequireAuth>} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
