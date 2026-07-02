import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { API, formatApiError } from "../App";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";

const formatDateTime = (value) => {
  if (!value) return "Not recorded";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatAction = (action) => {
  const labels = {
    delete_rejected_timesheet_requested: "Delete requested",
    delete_rejected_timesheet_failed: "Delete failed",
    deleted_rejected_timesheet: "Deleted rejected timesheet",
  };

  return labels[action] || String(action || "Audit event").replace(/_/g, " ");
};

const getActorLabel = (entry) => {
  return entry.actor_name || entry.deleted_by_name || entry.actor_email || entry.deleted_by_email || "Unknown admin";
};

const getEmployeeLabel = (entry) => {
  return entry.employee_name || entry.user_name || entry.employee_email || entry.user_email || "Unknown employee";
};

export default function ManageAuditLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAuditLog = async () => {
    try {
      setLoading(true);
      setError("");
      const { data } = await axios.get(`${API}/admin/audit-log?limit=100`, { withCredentials: true });
      setEntries(Array.isArray(data?.audit_entries) ? data.audit_entries : []);
    } catch (err) {
      console.error("Failed to fetch admin audit log:", err);
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLog();
  }, []);

  const deletedRejectedEntries = useMemo(() => {
    return entries.filter((entry) => {
      const action = String(entry?.action || "");
      return action.includes("delete_rejected") || action === "deleted_rejected_timesheet";
    });
  }, [entries]);

  return (
    <Layout>
      <div className="fade-in" data-testid="admin-audit-log-page">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Admin only</p>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="admin-audit-log-title">
              Audit Log
            </h1>
            <p className="text-gray-500 mt-1">
              Deleted rejected-timesheet activity for payroll accountability.
            </p>
          </div>

          <Button
            type="button"
            onClick={fetchAuditLog}
            disabled={loading}
            data-testid="refresh-audit-log-button"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="card p-4" data-testid="audit-total-card">
            <div className="flex items-center">
              <div className="p-2 bg-gray-100 rounded">
                <ShieldCheck className="w-4 h-4 text-gray-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Audit Events</p>
                <p className="text-xl font-bold">{entries.length}</p>
              </div>
            </div>
          </div>

          <div className="card p-4" data-testid="audit-deleted-rejected-card">
            <div className="flex items-center">
              <div className="p-2 bg-red-50 rounded">
                <Trash2 className="w-4 h-4 text-red-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Deleted Rejected</p>
                <p className="text-xl font-bold">{deletedRejectedEntries.length}</p>
              </div>
            </div>
          </div>

          <div className="card p-4" data-testid="audit-control-card">
            <div className="flex items-center">
              <div className="p-2 bg-amber-50 rounded">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Purpose</p>
                <p className="text-sm font-semibold text-gray-900">Payroll deletion control</p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="card p-4 mb-4 border border-red-200 bg-red-50 text-red-700" data-testid="audit-log-error">
            {error}
          </div>
        )}

        <div className="card" data-testid="audit-log-list">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Deleted rejected-timesheet audit trail</h2>
            <p className="text-sm text-gray-500 mt-1">
              Shows the latest backend audit records for rejected timesheet deletion actions.
            </p>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="spinner"></div>
            </div>
          ) : deletedRejectedEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-500" data-testid="audit-log-empty">
              No deleted rejected-timesheet audit records found.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {deletedRejectedEntries.map((entry) => (
                <div key={entry.id || `${entry.action}-${entry.at}`} className="p-4" data-testid="audit-log-row">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{formatAction(entry.action)}</p>
                      <p className="text-sm text-gray-500">
                        {formatDateTime(entry.deleted_confirmed_at || entry.delete_failed_at || entry.at)}
                      </p>
                    </div>
                    <span className="badge badge-rejected">
                      {entry.status_at_delete || "rejected"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Admin</p>
                      <p className="font-medium text-gray-900">{getActorLabel(entry)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Employee</p>
                      <p className="font-medium text-gray-900">{getEmployeeLabel(entry)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Week ending</p>
                      <p className="font-medium text-gray-900">{entry.week_ending || "Not recorded"}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Timesheet ID</p>
                      <p className="font-mono text-xs text-gray-700 break-all">{entry.timesheet_id || "Not recorded"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
