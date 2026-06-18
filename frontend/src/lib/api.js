import axios from "axios";

// TIMESHEET MANAGER / COMMERCIAL RELEASE API ENV-ONLY GUARD V3
const configuredBackendUrl = process.env.REACT_APP_BACKEND_URL;

if (!configuredBackendUrl) {
  throw new Error("REACT_APP_BACKEND_URL is required.");
}

const BACKEND_URL = configuredBackendUrl.replace(/\/$/, "");
export const API_BASE_URL = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export default api;