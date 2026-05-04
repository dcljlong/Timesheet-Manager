import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Plus, FileText, Clock, CheckCircle, AlertCircle, Settings, LogOut, Trash2 } from "lucide-react";
import Layout from "../components/Layout";
import { toast } from "sonner";

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hasDraft = localStorage.getItem("timesheet_form_draft_v1");
  const [timesheets, setTimesheets] = useState([]);
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [loading, setLoading] = useState(true);

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

  const getCalculatedTotalHours = (ts) => {
    if (!ts?.days) return parseFloat(ts?.total_hours || 0);
    return ts.days.reduce((sum, day) => {
      return sum + (day.entries || []).reduce((entrySum, entry) => {
        return entrySum + (parseFloat(entry.total_hours) || 0);
      }, 0);
    }, 0);
  };

  const handleDeleteTimesheet = async (timesheetId) => {
    const ok = window.confirm("Delete this timesheet? This cannot be undone.");
    if (!ok) return;

    try {
      await axios.delete(`${API}/timesheets/${timesheetId}`, { withCredentials: true });
      setTimesheets((prev) => prev.filter((ts) => ts.id !== timesheetId));
      setStats((prev) => ({ ...prev, total: Math.max(0, (prev.total || 0) - 1) }));
      toast.success("Timesheet deleted");
    } catch (err) {
      console.error(err);
      toast.error(formatApiError(err, "Delete failed"));
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

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  const pmEditedTimesheets = timesheets.filter(
    (ts) =>
      !!(ts.pm_edit_reason || ts.pm_last_edited_at) &&
      ["submitted", "pm_approved", "rejected"].includes(ts.status)
  );

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
      <div className="fade-in" data-testid="employee-dashboard">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="dashboard-title">
              Welcome, {user?.name}
            </h1>
            <p className="text-gray-500 mt-1">Manage your timesheets</p>
          </div>
          <div className="mt-4 sm:mt-0 flex gap-2">
            {hasDraft && (
              <Button
                variant="outline"
                onClick={() => navigate("/timesheet/new", { state: { resumeDraft: true } })}
                data-testid="resume-draft-button"
              >
                Resume Draft
              </Button>
            )}

            <Button
              onClick={() => {
                localStorage.removeItem("timesheet_form_draft_v1");
                navigate("/timesheet/new", { state: { freshStart: true, stamp: Date.now() } });
              }}
              className="bg-gray-900 hover:bg-gray-800"
              data-testid="new-timesheet-button"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Timesheet
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card p-6" data-testid="stat-total">
            <div className="flex items-center">
              <div className="p-3 bg-gray-100 rounded">
                <FileText className="w-5 h-5 text-gray-700" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Total Timesheets</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </div>
          
          <div className="card p-6" data-testid="stat-pending">
            <div className="flex items-center">
              <div className="p-3 bg-yellow-100 rounded">
                <Clock className="w-5 h-5 text-yellow-700" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-2xl font-bold">{stats.pending}</p>
              </div>
            </div>
          </div>
          
          <div className="card p-6" data-testid="stat-approved">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded">
                <CheckCircle className="w-5 h-5 text-green-700" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Approved</p>
                <p className="text-2xl font-bold">{stats.approved}</p>
              </div>
            </div>
          </div>
        </div>

        {pmEditedTimesheets.length > 0 && (
          <div className="card p-4 mb-6 border border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5" />
              <div className="space-y-2">
                <p className="font-semibold text-amber-900">Timesheet updated by PM</p>
                {pmEditedTimesheets.slice(0, 3).map((ts) => (
                  <div key={`pm-edit-alert-${ts.id}`} className="text-sm text-amber-800">
                    <span className="font-medium">{formatDate(ts.week_ending)}</span>
                    {ts.pm_last_edited_name ? ` ? ${ts.pm_last_edited_name}` : ""}
                    {ts.pm_edit_reason ? `: ${ts.pm_edit_reason}` : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recent Timesheets */}
        <div className="card" data-testid="timesheets-list">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Recent Timesheets</h2>
          </div>
          
          {timesheets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No timesheets yet. Create your first timesheet to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Week Ending</th>
                    <th>Period</th>
                    <th>Total Hours</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {timesheets.filter(ts => ts.status !== "draft").map((ts) => (
                    <tr key={ts.id} data-testid={`timesheet-row-${ts.id}`}>
                      <td className="font-medium">{formatDate(ts.week_ending)}</td>
                      <td className="capitalize">{ts.period_type}</td>
                      <td>{getCalculatedTotalHours(ts).toFixed(2)} hrs</td>
                      <td>{getStatusBadge(ts.status)}</td>
                      <td>
  <div className="flex items-center gap-2">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(`/timesheet/${ts.id}`)}
      data-testid={`view-timesheet-${ts.id}`}
    >
      View
    </Button>

    {(ts.status === "submitted" || ts.status === "rejected") && (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/timesheet/${ts.id}/edit`)}
        data-testid={`edit-timesheet-${ts.id}`}
      >
        Edit
      </Button>
    )}

    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleDeleteTimesheet(ts.id)}
      data-testid={`delete-timesheet-${ts.id}`}
    >
      <Trash2 className="w-4 h-4 mr-1" />
      Delete
    </Button>
  </div>
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









