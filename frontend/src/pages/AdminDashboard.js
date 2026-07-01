import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API } from "../App";
import axios from "axios";
import { Button } from "../components/ui/button";
import { FileText, Users, Clock, CheckCircle, XCircle, Layers, UserCog, Download, Briefcase } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const timesheetReviewRef = useRef(null);
  const [timesheets, setTimesheets] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    pending_pm_approval: 0,
    pending_admin_approval: 0,
    approved: 0,
    rejected: 0
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending_pm");
  const [selectedWeekEnding, setSelectedWeekEnding] = useState("all");
  const [smartlyPayGroup, setSmartlyPayGroup] = useState("all");
  const [smartlySummary, setSmartlySummary] = useState(null);
  const [smartlyLoading, setSmartlyLoading] = useState(false);
  const [smartlyExporting, setSmartlyExporting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tsRes, statsRes] = await Promise.all([
        axios.get(`${API}/timesheets`, { withCredentials: true }),
        axios.get(`${API}/dashboard/stats`, { withCredentials: true })
      ]);
      setTimesheets(tsRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  };

  const smartlyPayGroupOptions = smartlySummary?.available_pay_groups || [];
  const currentSmartlyScopeKey = `${selectedWeekEnding}::${smartlyPayGroup}`;
  const isSmartlySummaryCurrent =
    Boolean(smartlySummary) && smartlySummary.validated_scope_key === currentSmartlyScopeKey;

  // TIMESHEET MANAGER / SMARTLY EXCLUSION DISPLAY NORMALISER V7
  // Smartly validation exclusions are expected payroll exclusions, not errors.
  // Normalise old/raw backend reason strings into clear admin wording.
  const formatSmartlyExclusionDisplay = (item) => {
    const employeeName = item?.employee_name || "Unknown";
    const rawReason = String(item?.reason || "").trim();

    const knownLabels = {
      annual_leave: "Annual Leave",
      sick: "Sick",
      public_holiday: "Public Holiday",
      no_work: "No Work",
      unpaid_day_off: "No Work"
    };

    const rawType =
      item?.entry_type ||
      rawReason.split(":").pop()?.trim() ||
      "";

    const normalisedType = String(rawType)
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, "_");

    const label = knownLabels[normalisedType] ||
      normalisedType
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") ||
      "Non-work row";

    return `${employeeName} — ${label} recorded on timesheet, excluded from Smartly work-hours CSV.`;
  };
  const weekOptions = Array.from(
    new Set(timesheets.map(ts => ts.week_ending).filter(Boolean))
  ).sort((a, b) => new Date(b) - new Date(a));

  const filteredTimesheets = timesheets.filter(ts => {
    const matchesStatus =
      filter === "pending_pm" ? ts.status === "submitted" :
      filter === "pending_admin" ? ts.status === "pm_approved" :
      filter === "approved" ? ts.status === "approved" :
      filter === "rejected" ? ts.status === "rejected" :
      true;

    const matchesWeek =
      selectedWeekEnding === "all" ? true : ts.week_ending === selectedWeekEnding;

    return matchesStatus && matchesWeek;
  });

  const handleDashboardStatusClick = (nextFilter) => {
    setFilter(nextFilter);
    window.requestAnimationFrame(() => {
      timesheetReviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.append("status", filter);
      if (selectedWeekEnding !== "all") params.append("week_ending", selectedWeekEnding);

      const queryString = params.toString();
      const url = queryString
        ? `${API}/timesheets/export.csv?${queryString}`
        : `${API}/timesheets/export.csv`;

      const response = await axios.get(url, {
        withCredentials: true,
        responseType: "blob"
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `timesheets_${filter}_${selectedWeekEnding === "all" ? "all-weeks" : selectedWeekEnding}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("CSV export failed:", err);
      window.alert("CSV export failed");
    }
  };

  const handleSmartlyValidate = async () => {
    try {
      setSmartlyLoading(true);
      const params = new URLSearchParams();
      if (selectedWeekEnding !== "all") params.append("week_ending", selectedWeekEnding);
      if (smartlyPayGroup !== "all") params.append("pay_group", smartlyPayGroup);

      const queryString = params.toString();
      const url = queryString
        ? `${API}/timesheets/smartly-export-summary?${queryString}`
        : `${API}/timesheets/smartly-export-summary`;

      const { data } = await axios.get(url, { withCredentials: true });
      setSmartlySummary({
        ...data,
        validated_scope_key: `${selectedWeekEnding}::${smartlyPayGroup}`
      });
    } catch (err) {
      console.error("Smartly validation failed:", err);
      window.alert("Smartly validation failed");
    } finally {
      setSmartlyLoading(false);
    }
  };

  const handleSmartlyExport = async () => {
    if (!smartlySummary) {
      window.alert("Run Validate Weekly Smartly Export first for the selected week/pay group");
      return;
    }

    if ((smartlySummary.ready_row_count || 0) <= 0) {
      window.alert("No Smartly-ready rows found for export");
      return;
    }

    try {
      setSmartlyExporting(true);
      const params = new URLSearchParams();
      if (selectedWeekEnding !== "all") params.append("week_ending", selectedWeekEnding);
      if (smartlyPayGroup !== "all") params.append("pay_group", smartlyPayGroup);

      const queryString = params.toString();
      const url = queryString
        ? `${API}/timesheets/smartly-export.csv?${queryString}`
        : `${API}/timesheets/smartly-export.csv`;

      const response = await axios.get(url, {
        withCredentials: true,
        responseType: "blob"
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `smartly_batch_${smartlyPayGroup === "all" ? "all-pay-groups" : smartlyPayGroup}_${selectedWeekEnding === "all" ? "all-weeks" : selectedWeekEnding}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Smartly export failed:", err);
      window.alert("Smartly export failed");
    } finally {
      setSmartlyExporting(false);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      submitted: "badge badge-submitted",
      pm_approved: "badge badge-pm-approved",
      approved: "badge badge-approved",
      rejected: "badge badge-rejected"
    };
    const labels = {
      submitted: "Pending PM",
      pm_approved: "Pending Admin",
      approved: "Approved",
      rejected: "Not Approved"
    };
    return <span className={badges[status] || "badge"}>{labels[status] || status}</span>;
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="spinner"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="fade-in tsm-admin-dashboard" data-testid="admin-dashboard">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="admin-dashboard-title">
            Admin Dashboard
          </h1>
          <p className="text-gray-500 mt-1">Review weekly payroll timesheets and settings</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="card p-4 cursor-pointer hover:shadow-md transition-shadow" data-testid="stat-total" onClick={() => handleDashboardStatusClick("all")}>
            <div className="flex items-center">
              <div className="p-2 bg-gray-100 rounded">
                <FileText className="w-4 h-4 text-gray-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-xl font-bold">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 cursor-pointer hover:shadow-md transition-shadow" data-testid="stat-pending-pm" onClick={() => handleDashboardStatusClick("pending_pm")}>
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded">
                <Clock className="w-4 h-4 text-yellow-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Pending PM</p>
                <p className="text-xl font-bold">{stats.pending_pm_approval}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 cursor-pointer hover:shadow-md transition-shadow" data-testid="stat-pending-admin" onClick={() => handleDashboardStatusClick("pending_admin")}>
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded">
                <Clock className="w-4 h-4 text-blue-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Pending Admin</p>
                <p className="text-xl font-bold">{stats.pending_admin_approval}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 cursor-pointer hover:shadow-md transition-shadow" data-testid="stat-approved" onClick={() => handleDashboardStatusClick("approved")}>
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded">
                <CheckCircle className="w-4 h-4 text-green-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-xl font-bold">{stats.approved}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 cursor-pointer hover:shadow-md transition-shadow" data-testid="stat-rejected" onClick={() => handleDashboardStatusClick("rejected")}>
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded">
                <XCircle className="w-4 h-4 text-red-700" />
              </div>
              <div className="ml-3">
                <p className="text-xs text-gray-500">Rejected</p>
                <p className="text-xl font-bold">{stats.rejected}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          <button
            onClick={() => navigate("/admin/users")}
            className="card p-4 flex items-center hover:bg-gray-50 transition-colors text-left"
            data-testid="manage-users-link"
          >
            <div className="p-3 bg-purple-100 rounded">
              <Users className="w-5 h-5 text-purple-700" />
            </div>
            <div className="ml-4">
              <p className="font-medium">Manage Users</p>
              <p className="text-sm text-gray-500">View and edit user roles</p>
            </div>
          </button>

          <button
            onClick={() => navigate("/admin/task-codes")}
            className="card p-4 flex items-center hover:bg-gray-50 transition-colors text-left"
            data-testid="manage-codes-link"
          >
            <div className="p-3 bg-orange-100 rounded">
              <Layers className="w-5 h-5 text-orange-700" />
            </div>
            <div className="ml-4">
              <p className="font-medium">Task Codes</p>
              <p className="text-sm text-gray-500">Manage analysis codes</p>
            </div>
          </button>

          <button
            onClick={() => navigate("/admin/job-numbers")}
            className="card p-4 flex items-center hover:bg-gray-50 transition-colors text-left"
            data-testid="manage-job-numbers-link"
          >
            <div className="p-3 bg-blue-100 rounded">
              <Briefcase className="w-5 h-5 text-blue-700" />
            </div>
            <div className="ml-4">
              <p className="font-medium">Job Numbers</p>
              <p className="text-sm text-gray-500">Manage job/source list</p>
            </div>
          </button>

          <button
            onClick={() => navigate("/admin/pms")}
            className="card p-4 flex items-center hover:bg-gray-50 transition-colors text-left"
            data-testid="manage-pms-link"
          >
            <div className="p-3 bg-teal-100 rounded">
              <UserCog className="w-5 h-5 text-teal-700" />
            </div>
            <div className="ml-4">
              <p className="font-medium">Project Managers</p>
              <p className="text-sm text-gray-500">Manage PM list</p>
            </div>
          </button>
        </div>

        {/* Week Filter */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-sm font-medium text-gray-700">Week Ending</label>
          <select
            value={selectedWeekEnding}
            onChange={(e) => setSelectedWeekEnding(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
            data-testid="week-ending-filter"
          >
            <option value="all">All weeks</option>
            {weekOptions.map((week) => (
              <option key={week} value={week}>
                {format(new Date(week), "d MMM yyyy")}
              </option>
            ))}
          </select>
          <p className="text-sm text-gray-500">
            Showing {filteredTimesheets.length} of {timesheets.length}
          </p>
        </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            data-testid="admin-export-csv-button"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Payroll Review CSV
          </Button>

          <div className="card p-4 mb-4" data-testid="smartly-export-panel">
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Smartly Pay Group</label>
                <select
                  value={smartlyPayGroup}
                  onChange={(e) => setSmartlyPayGroup(e.target.value)}
                  className="mt-1 h-9 rounded-md border border-gray-300 bg-white px-3 text-sm min-w-[180px]"
                  data-testid="smartly-pay-group-filter"
                >
                  <option value="all">All pay groups</option>
                  {smartlyPayGroupOptions.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSmartlyValidate}
                disabled={smartlyLoading}
                data-testid="validate-smartly-export-button"
              >
                {smartlyLoading ? "Validating..." : "Validate Weekly Smartly Export"}
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleSmartlyExport}
                disabled={smartlyExporting || !isSmartlySummaryCurrent || (smartlySummary?.issue_count || 0) > 0 || (smartlySummary?.ready_row_count || 0) <= 0}
                data-testid="export-smartly-csv-button"
              >
                <Download className="w-4 h-4 mr-2" />
                {smartlyExporting ? "Exporting..." : "Export Weekly Smartly Batch CSV"}
              </Button>
            </div>

            {smartlySummary && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div className="rounded border p-3">
                    <p className="text-gray-500">Ready Timesheets</p>
                    <p className="text-lg font-semibold">{smartlySummary.ready_timesheet_count}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-gray-500">Ready Employees</p>
                    <p className="text-lg font-semibold">{smartlySummary.ready_employee_count}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-gray-500">Ready Rows</p>
                    <p className="text-lg font-semibold">{smartlySummary.ready_row_count}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-gray-500">Issues</p>
                    <p className="text-lg font-semibold">{smartlySummary.issue_count}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-gray-500">Excluded</p>
                    <p className="text-lg font-semibold">{smartlySummary.exclusion_count}</p>
                  </div>
                </div>


                {(smartlySummary.ready_row_count || 0) <= 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No Smartly-ready rows found for this selection. Try another week or pay group, or make sure timesheets are approved first.
                  </div>
                )}

                {isSmartlySummaryCurrent && smartlySummary.issue_count > 0 && (
                  <div>
                    <p className="text-sm font-medium text-red-700 mb-1">Top Issues</p>
                    <ul className="text-sm text-red-700 space-y-1">
                      {smartlySummary.issues.slice(0, 5).map((item, idx) => (
                        <li key={`issue-${idx}`}>
                          {(item.employee_name || "Unknown")} - {item.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isSmartlySummaryCurrent && smartlySummary.exclusion_count > 0 && (
                  <div>
                    <p className="text-sm font-medium text-amber-700 mb-1">Non-work rows excluded from work-hours export</p>
                    <ul className="text-sm text-amber-700 space-y-1">
                      {smartlySummary.exclusions.slice(0, 5).map((item, idx) => (
                        <li key={`exclusion-${idx}`}>
                          {formatSmartlyExclusionDisplay(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-4" ref={timesheetReviewRef} data-testid="admin-review-filter-tabs">
          {[
            { key: "all", label: "Total" },
            { key: "pending_pm", label: "Pending PM" },
            { key: "pending_admin", label: "Pending Admin" },
            { key: "approved", label: "Approved" },
            { key: "rejected", label: "Rejected" }
          ].map(f => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.key)}
              data-testid={`filter-${f.key}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* Timesheets List */}
        <div className="card" data-testid="admin-timesheets-list">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">{filter === "all" ? "Total Timesheets" : filter === "pending_pm" ? "Pending PM Approval" : filter === "pending_admin" ? "Pending Admin Approval" : filter === "approved" ? "Approved Timesheets" : "Rejected Timesheets"}</h2>
          </div>

          {filteredTimesheets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>{filter === "all" ? "No timesheets found" : filter === "pending_pm" ? "No timesheets pending PM approval" : filter === "pending_admin" ? "No timesheets pending admin approval" : filter === "approved" ? "No approved timesheets found" : "No rejected timesheets found"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Week Ending</th>
                    <th>Period</th>
                    <th>Total Hours</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimesheets.map((ts) => (
                    <tr key={ts.id} data-testid={`admin-ts-row-${ts.id}`}>
                      <td className="font-medium">{ts.employee_name}</td>
                      <td>{format(new Date(ts.week_ending), "d MMM yyyy")}</td>
                      <td className="capitalize">{ts.period_type}</td>
                      <td>{ts.total_hours.toFixed(2)} hrs</td>
                      <td>{getStatusBadge(ts.status)}</td>
                      <td className="text-gray-500">{format(new Date(ts.created_at), "d MMM")}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/timesheet/${ts.id}`)}
                          data-testid={`admin-view-ts-${ts.id}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

