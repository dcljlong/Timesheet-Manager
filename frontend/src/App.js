import { createContext, useContext, useState, useEffect, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "sonner";
import api from "./lib/api";

export const API = "http://127.0.0.1:8000/api";

export const formatApiError = (error) => {
  const detail = error?.response?.data?.detail;
  if (!detail) return "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return JSON.stringify(detail);
};

// Pages
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import TimesheetForm from "./pages/TimesheetForm";
import PMDashboard from "./pages/PMDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TimesheetView from "./pages/TimesheetView";
import SettingsPage from "./pages/SettingsPage";
import ManageTaskCodes from "./pages/ManageTaskCodes";
import ManagePMs from "./pages/ManagePMs";
import ManageUsers from "./pages/ManageUsers";

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

const applyAuthToken = (token) => {
  if (token) {
    localStorage.setItem("access_token", token);
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem("access_token");
    delete axios.defaults.headers.common.Authorization;
    delete api.defaults.headers.common.Authorization;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const existingToken = localStorage.getItem("access_token");
      if (existingToken) {
        applyAuthToken(existingToken);
      }

      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      applyAuthToken(null);
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });

    if (data?.access_token) {
      applyAuthToken(data.access_token);
    }

    setUser({
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
      created_at: data.created_at,
    });

    return data;
  };

  const register = async (email, password, name, role) => {
    const { data } = await api.post("/auth/register", { email, password, name, role });
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    applyAuthToken(null);
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const RoleBasedRedirect = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  switch (user.role) {
    case "admin":
      return <Navigate to="/admin" replace />;
    case "project_manager":
      return <Navigate to="/pm" replace />;
    default:
      return <Navigate to="/employee" replace />;
  }
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<RoleBasedRedirect />} />

          <Route path="/employee" element={
            <ProtectedRoute allowedRoles={["employee", "project_manager", "admin"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          } />
          <Route path="/timesheet/new" element={
            <ProtectedRoute allowedRoles={["employee", "project_manager", "admin"]}>
              <TimesheetForm />
            </ProtectedRoute>
          } />
          <Route path="/timesheet/:id" element={
            <ProtectedRoute allowedRoles={["employee", "project_manager", "admin"]}>
              <TimesheetView />
            </ProtectedRoute>
          } />
          <Route path="/timesheet/:id/edit" element={
            <ProtectedRoute allowedRoles={["employee", "project_manager", "admin"]}>
              <TimesheetForm />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute allowedRoles={["employee", "project_manager", "admin"]}>
              <SettingsPage />
            </ProtectedRoute>
          } />

          <Route path="/pm" element={
            <ProtectedRoute allowedRoles={["project_manager", "admin"]}>
              <PMDashboard />
            </ProtectedRoute>
          } />

          <Route path="/admin" element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          } />
          <Route path="/admin/task-codes" element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageTaskCodes />
            </ProtectedRoute>
          } />
          <Route path="/admin/pms" element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManagePMs />
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageUsers />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
