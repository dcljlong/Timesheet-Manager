import axios from "axios";

// TIMESHEET MANAGER / COMMERCIAL RELEASE API FALLBACK GUARD V1
const configuredBackendUrl = process.env.REACT_APP_BACKEND_URL;

if (process.env.NODE_ENV === "production" && !configuredBackendUrl) {
  throw new Error("REACT_APP_BACKEND_URL is required in production.");
}

const BACKEND_URL = (configuredBackendUrl || "http://127.0.0.1:8000").replace(/\/$/, "");
export const API_BASE_URL = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export default api;