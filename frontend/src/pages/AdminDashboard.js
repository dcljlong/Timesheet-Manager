import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API } from "../App";
import axios from "axios";
import { Button } from "../components/ui/button";
import { FileText, Users, Clock, CheckCircle, XCircle, Layers, UserCog } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [timesheets, setTimesheets] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    pending_pm_approval: 0,
    pending_admin_approval: 0,
    approved: 0,
    rejected: 0
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

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

  const filteredTimesheets = timesheets.filter(ts => {
    if (filter === "pending_pm") return ts.status === "submitted";
    if (filter === "pending_admin") return ts.status === "pm_approved";
    if (filter === "approved") return ts.status === "approved";
    if (filter === "rejected") return ts.status === "rejected";
    return true;
  });

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
      rejected: "Rejected"
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
      <div className="fade-in" data-testid="admin-dashboard">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="admin-dashboard-title">
            Admin Dashboard
          </h1>
          <p className="text-gray-500 mt-1">Manage all timesheets and settings</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="card p-4" data-testid="stat-total">
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

          <div className="card p-4" data-testid="stat-pending-pm">
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

          <div className="card p-4" data-testid="stat-pending-admin">
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

          <div className="card p-4" data-testid="stat-approved">
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

          <div className="card p-4" data-testid="stat-rejected">
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: "all", label: "All" },
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
            <h2 className="font-semibold text-gray-900">All Timesheets</h2>
          </div>

          {filteredTimesheets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No timesheets found</p>
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
