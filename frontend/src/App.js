import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import api, { API_BASE_URL } from "./lib/api";
import { playTimesheetReminderSound, TIMESHEET_REMINDER_SOUND_MARKER } from "./lib/reminderSound";

export const API = API_BASE_URL;

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
import ManageJobNumbers from "./pages/ManageJobNumbers";
import ManagePMs from "./pages/ManagePMs";
import ManageUsers from "./pages/ManageUsers";

const ThemeContext = createContext(null);

export const useTheme = () => useContext(ThemeContext);

const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("lls_theme") || "light";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("lls_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => current === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
};
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

  // TIMESHEET / LOGIN FETCH FALLBACK V1
  const login = async (email, password) => {
    let data = null;
    let axiosError = null;

    try {
      const response = await api.post("/auth/login", { email, password });
      data = response.data;
    } catch (err) {
      axiosError = err;
    }

    if (!data?.access_token) {
      try {
        const response = await fetch(API_BASE_URL + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        const responseText = await response.text();
        let parsed = null;

        try {
          parsed = responseText ? JSON.parse(responseText) : null;
        } catch {
          parsed = { detail: responseText || "Login failed" };
        }

        if (!response.ok) {
          const fallbackError = new Error(parsed?.detail || `Login failed with status ${response.status}`);
          fallbackError.response = { status: response.status, data: parsed };
          throw fallbackError;
        }

        data = parsed;
      } catch (fetchError) {
        throw axiosError || fetchError;
      }
    }

    if (!data?.access_token) {
      throw new Error("Login succeeded but no access token was returned.");
    }

    applyAuthToken(data.access_token);

    const loginUser = data?.user || data;

    setUser({
      id: loginUser?.id,
      email: loginUser?.email,
      name: loginUser?.name,
      role: loginUser?.role || "employee",
      company: loginUser?.company || null,
      created_at: loginUser?.created_at,
    });

    return data;
  };

  const register = async (email, password, name, role) => {
    const { data } = await api.post("/auth/register", { email, password, name, role });
    return data;
  };

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    applyAuthToken(null);
    setUser(false);
  }, []);

  useEffect(() => {
    const auth401Interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        const requestUrl = error?.config?.url || "";

        if (
          status === 401 &&
          !requestUrl.includes("/auth/login") &&
          !requestUrl.includes("/auth/logout")
        ) {
          logout();
        }

        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(auth401Interceptor);
    };
  }, [logout]);

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

const REMINDER_CHECK_INTERVAL_MS = 60000;
const REMINDER_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const normaliseReminderSettings = (settings = {}) => ({
  reminder_time: settings.reminder_time || "17:00",
  reminder_day: settings.reminder_day || "Friday",
  reminder_frequency: settings.reminder_frequency || "weekly",
  enabled: settings.enabled !== false,
});

const isReminderDueNow = (settings, now) => {
  if (!settings.enabled) return false;

  const [hourText, minuteText] = String(settings.reminder_time || "17:00").split(":");
  const targetHour = Number(hourText);
  const targetMinute = Number(minuteText);

  if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetHour * 60 + targetMinute;

  if (currentMinutes < targetMinutes) return false;

  if (settings.reminder_frequency === "daily") return true;

  return REMINDER_DAYS[now.getDay()] === settings.reminder_day;
};

const getReminderFiredKey = (settings, now) => {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return `timesheet_reminder_fired_v1_${settings.reminder_frequency || "weekly"}_${yyyy}-${mm}-${dd}`;
};

const TimesheetReminderRunner = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user === false) return undefined;

    let stopped = false;

    const checkReminder = async () => {
      try {
        const { data } = await api.get("/notification-settings");
        if (stopped) return;

        const settings = normaliseReminderSettings(data);
        const now = new Date();

        if (!isReminderDueNow(settings, now)) return;

        const firedKey = getReminderFiredKey(settings, now);
        if (window.localStorage.getItem(firedKey) === "1") return;

        window.localStorage.setItem(firedKey, TIMESHEET_REMINDER_SOUND_MARKER);

        toast.warning("Timesheet reminder: fill in your timesheet.", {
          duration: 12000,
          description: settings.reminder_frequency === "daily"
            ? "Daily reminder from your Settings page."
            : `Weekly reminder for ${settings.reminder_day}.`,
        });

        await playTimesheetReminderSound();
      } catch (err) {
        console.error("Timesheet reminder check failed:", err);
      }
    };

    checkReminder();
    const intervalId = window.setInterval(checkReminder, REMINDER_CHECK_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [user]);

  return null;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Toaster position="top-right" richColors />
        <TimesheetReminderRunner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/register"
            element={
              process.env.REACT_APP_ALLOW_PUBLIC_REGISTRATION === "true" ? (
                <RegisterPage />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
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
          <Route path="/admin/job-numbers" element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageJobNumbers />
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
    </ThemeProvider>
  );
}

export default App;
