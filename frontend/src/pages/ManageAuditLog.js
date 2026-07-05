import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
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
    voided_approved_test_timesheet: "Voided approved test timesheet",
    void_approved_test_timesheet_failed: "Void approved test failed",
  };

  return labels[action] || String(action || "Audit event").replace(/_/g, " ");
};

const getActorLabel = (entry) => {
  return entry.actor_name || entry.deleted_by_name || entry.actor_email || entry.deleted_by_email || "Unknown admin";
};

const getEmployeeLabel = (entry) => {
  return entry.employee_name || entry.user_name || entry.employee_email || entry.user_email || "Unknown employee";
};

const buildSearchText = (entry) => {
  return [
    entry?.action,
    entry?.employee_name,
    entry?.user_name,
    entry?.employee_email,
    entry?.user_email,
    entry?.by_email,
    entry?.by_name,
    entry?.actor_email,
    entry?.actor_name,
    entry?.week_ending,
    entry?.job_numbers,
    entry?.task_codes,
    entry?.timesheet_id,
    entry?.rejection_comment,
    entry?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const formatAuditList = (value) => {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "Not recorded";
  }

  return value || "Not recorded";
};

const detailRows = [
  ["Action", (entry) => formatAction(entry.action)],
  ["Deleted at", (entry) => formatDateTime(entry.deleted_confirmed_at || entry.at)],
  ["Requested at", (entry) => formatDateTime(entry.at)],
  ["Admin", getActorLabel],
  ["Admin email", (entry) => entry.by_email || entry.actor_email || entry.deleted_by_email || "Not recorded"],
  ["Employee", getEmployeeLabel],
  ["Week ending", (entry) => entry.week_ending || "Not recorded"],
  ["Total hours", (entry) => entry.total_hours ?? "Not recorded"],
  ["Job numbers", (entry) => formatAuditList(entry.job_numbers)],
  ["Task codes", (entry) => formatAuditList(entry.task_codes)],
  ["Status at delete", (entry) => entry.status_at_delete || "Not recorded"],
  ["Timesheet ID", (entry) => entry.timesheet_id || "Not recorded"],
  ["Audit ID", (entry) => entry.id || "Not recorded"],
  ["Source", (entry) => entry.source || "Not recorded"],
  ["Rejection comment", (entry) => entry.rejection_comment || "Not recorded"],
];

export default function ManageAuditLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    employee: "",
    weekEnding: "",
    action: "all",
  });

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
      return action.includes("delete_rejected") ||
        action === "deleted_rejected_timesheet" ||
        action.includes("void_approved_test") ||
        action.includes("voided_approved_test");
    });
  }, [entries]);

  const filterOptions = useMemo(() => {
    const employees = Array.from(new Set(deletedRejectedEntries.map(getEmployeeLabel))).sort();
    const weeks = Array.from(new Set(deletedRejectedEntries.map((entry) => entry.week_ending).filter(Boolean))).sort().reverse();
    const actions = Array.from(new Set(deletedRejectedEntries.map((entry) => entry.action).filter(Boolean))).sort();

    return { employees, weeks, actions };
  }, [deletedRejectedEntries]);

  const filteredEntries = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return deletedRejectedEntries.filter((entry) => {
      const employee = getEmployeeLabel(entry);
      const matchesSearch = !search || buildSearchText(entry).includes(search);
      const matchesEmployee = !filters.employee || employee === filters.employee;
      const matchesWeek = !filters.weekEnding || entry.week_ending === filters.weekEnding;
      const matchesAction = filters.action === "all" || entry.action === filters.action;

      return matchesSearch && matchesEmployee && matchesWeek && matchesAction;
    });
  }, [deletedRejectedEntries, filters]);

  const hasActiveFilters = Boolean(
    filters.search.trim() ||
    filters.employee ||
    filters.weekEnding ||
    filters.action !== "all"
  );

  const clearFilters = () => {
    setFilters({
      search: "",
      employee: "",
      weekEnding: "",
      action: "all",
    });
  };

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

        <div className="card p-4 mb-6" data-testid="audit-log-filters">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Find audit events</h2>
              <p className="text-sm text-gray-500 mt-1">
                Filter by employee, week ending, action, admin email, timesheet ID, or rejection comment.
              </p>
            </div>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                onClick={clearFilters}
                data-testid="audit-log-clear-filters"
              >
                <X className="w-4 h-4 mr-2" />
                Clear filters
              </Button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Search</span>
              <div className="mt-1 flex items-center rounded border border-gray-200 bg-white px-3">
                <Search className="w-4 h-4 text-gray-400 mr-2" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="Name, email, ID, comment"
                  className="w-full py-2 text-sm outline-none"
                  data-testid="audit-log-search-filter"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Employee</span>
              <select
                value={filters.employee}
                onChange={(event) => setFilters((current) => ({ ...current, employee: event.target.value }))}
                className="mt-1 w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm"
                data-testid="audit-log-employee-filter"
              >
                <option value="">All employees</option>
                {filterOptions.employees.map((employee) => (
                  <option key={employee} value={employee}>{employee}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Week ending</span>
              <select
                value={filters.weekEnding}
                onChange={(event) => setFilters((current) => ({ ...current, weekEnding: event.target.value }))}
                className="mt-1 w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm"
                data-testid="audit-log-week-filter"
              >
                <option value="">All weeks</option>
                {filterOptions.weeks.map((week) => (
                  <option key={week} value={week}>{week}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Action</span>
              <select
                value={filters.action}
                onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
                className="mt-1 w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm"
                data-testid="audit-log-action-filter"
              >
                <option value="all">All actions</option>
                {filterOptions.actions.map((action) => (
                  <option key={action} value={action}>{formatAction(action)}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-3 text-xs text-gray-500" data-testid="audit-log-filter-count">
            Showing {filteredEntries.length} of {deletedRejectedEntries.length} deleted rejected-timesheet audit records.
          </p>
        </div>

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
          ) : filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-500" data-testid="audit-log-empty">
              {hasActiveFilters
                ? "No deleted rejected-timesheet audit records match the current filters."
                : "No deleted rejected-timesheet audit records found."}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredEntries.map((entry) => (
                <div key={entry.id || `${entry.action}-${entry.at}`} className="p-4" data-testid="audit-log-row">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{formatAction(entry.action)}</p>
                      <p className="text-sm text-gray-500">
                        {formatDateTime(entry.deleted_confirmed_at || entry.delete_failed_at || entry.at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="badge badge-rejected">
                        {entry.status_at_delete || "rejected"}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSelectedEntry(entry)}
                        data-testid="audit-log-view-details"
                      >
                        View details
                      </Button>
                    </div>
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

        {selectedEntry && (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            data-testid="audit-log-detail-drawer"
            onClick={() => setSelectedEntry(null)}
          >
            <div
              className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 flex items-start justify-between border-b border-gray-100 bg-white p-5">
                <div>
                  <p className="text-sm font-medium text-gray-500">Audit event details</p>
                  <h2 className="text-xl font-bold text-gray-900">
                    {formatAction(selectedEntry.action)}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {formatDateTime(selectedEntry.deleted_confirmed_at || selectedEntry.at)}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedEntry(null)}
                  data-testid="audit-log-close-details"
                >
                  <X className="w-4 h-4 mr-2" />
                  Close
                </Button>
              </div>

              <div className="p-5">
                <div className="rounded border border-red-100 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-900">Deleted rejected timesheet</p>
                  <p className="mt-1 text-sm text-red-700">
                    This record confirms a rejected, unprocessed timesheet was deleted and retained in the admin audit trail.
                  </p>
                </div>

                <div className="mt-5 divide-y divide-gray-100 rounded border border-gray-100" data-testid="audit-log-detail-fields">
                  {detailRows.map(([label, resolveValue]) => (
                    <div key={label} className="grid grid-cols-1 gap-1 p-3 md:grid-cols-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
                      <p className="break-words text-sm font-medium text-gray-900 md:col-span-2">
                        {resolveValue(selectedEntry)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
