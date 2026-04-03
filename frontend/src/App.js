import { createContext, useContext, useState, useEffect, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";

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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Configure axios
axios.defaults.withCredentials = true;

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null); // null = checking, false = not auth, object = auth
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`, { withCredentials: true });
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const { data } = await axios.post(`${API}/auth/login`, { email, password }, { withCredentials: true });
    setUser(data);
    return data;
  };

  const register = async (email, password, name, role) => {
    const { data } = await axios.post(`${API}/auth/register`, { email, password, name, role }, { withCredentials: true });
    setUser(data);
    return data;
  };

  const logout = async () => {
    await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route
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

// Redirect based on role
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

// Notification Sound Hook
export const useNotificationSound = () => {
  const playSound = useCallback(() => {
    const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleAoAPJnUqXhQChIpmMSsfmY4KF2XsaBzYEY3XJKcimtfV1RphZN+bWJbZX2Oj3tsZ2Z0g4yCd3Bvdn6Bf3l1dXl9fnx6eHl6e3t7enp6ent7e3t7e3t7e3t7");
    audio.volume = 0.5;
    audio.play().catch(() => {});
  }, []);

  return playSound;
};

// Format API Error
export const formatApiError = (error) => {
  const detail = error?.response?.data?.detail;
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
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
          
          {/* Employee Routes */}
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
          
          {/* PM Routes */}
          <Route path="/pm" element={
            <ProtectedRoute allowedRoles={["project_manager", "admin"]}>
              <PMDashboard />
            </ProtectedRoute>
          } />
          
          {/* Admin Routes */}
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
