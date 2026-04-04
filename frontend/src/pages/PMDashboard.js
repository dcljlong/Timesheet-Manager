import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API } from "../App";
import axios from "axios";
import { Button } from "../components/ui/button";
import { ClipboardList, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";

export default function PMDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [timesheets, setTimesheets] = useState([]);
  const [stats, setStats] = useState({ pending_approval: 0, my_timesheets: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

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
    if (filter === "pending") return ts.status === "submitted";
    if (filter === "approved") return ts.pm_approved;
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
      submitted: "Pending Approval",
      pm_approved: "Approved by PM",
      approved: "Fully Approved",
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
      <div className="fade-in" data-testid="pm-dashboard">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="pm-dashboard-title">
            PM Approvals
          </h1>
          <p className="text-gray-500 mt-1">Review and approve timesheets</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="card p-6" data-testid="stat-pending">
            <div className="flex items-center">
              <div className="p-3 bg-yellow-100 rounded">
                <Clock className="w-5 h-5 text-yellow-700" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Pending Approval</p>
                <p className="text-2xl font-bold">{stats.pending_approval || 0}</p>
              </div>
            </div>
          </div>
          <div className="card p-6" data-testid="stat-my-ts">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded">
                <ClipboardList className="w-5 h-5 text-blue-700" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">My Timesheets</p>
                <p className="text-2xl font-bold">{stats.my_timesheets || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2 mb-4">
          <Button
            variant={filter === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("pending")}
            data-testid="filter-pending"
          >
            Pending
          </Button>
          <Button
            variant={filter === "approved" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("approved")}
            data-testid="filter-approved"
          >
            Approved
          </Button>
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
            data-testid="filter-all"
          >
            All
          </Button>
        </div>

        {/* Timesheets List */}
        <div className="card" data-testid="pm-timesheets-list">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Timesheets for Approval</h2>
          </div>

          {filteredTimesheets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-300" />
              <p>No timesheets {filter === "pending" ? "pending approval" : "found"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Week Ending</th>
                    <th>Total Hours</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimesheets.map((ts) => (
                    <tr key={ts.id} data-testid={`pm-ts-row-${ts.id}`}>
                      <td className="font-medium">{ts.employee_name}</td>
                      <td>{format(new Date(ts.week_ending), "d MMM yyyy")}</td>
                      <td>{ts.total_hours.toFixed(2)} hrs</td>
                      <td>{getStatusBadge(ts.status)}</td>
                      <td className="text-gray-500">{format(new Date(ts.created_at), "d MMM")}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/timesheet/${ts.id}`)}
                          data-testid={`pm-view-ts-${ts.id}`}
                        >
                          {ts.status === "submitted" ? "Review" : "View"}
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
