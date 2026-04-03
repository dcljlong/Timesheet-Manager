import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, API } from "../App";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Plus, FileText, Clock, CheckCircle, AlertCircle, Settings, LogOut } from "lucide-react";
import Layout from "../components/Layout";

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
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

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
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
      <div className="fade-in" data-testid="employee-dashboard">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="dashboard-title">
              Welcome, {user?.name}
            </h1>
            <p className="text-gray-500 mt-1">Manage your timesheets</p>
          </div>
          <Button 
            onClick={() => navigate("/timesheet/new")} 
            className="mt-4 sm:mt-0 bg-gray-900 hover:bg-gray-800"
            data-testid="new-timesheet-button"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Timesheet
          </Button>
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
                  {timesheets.map((ts) => (
                    <tr key={ts.id} data-testid={`timesheet-row-${ts.id}`}>
                      <td className="font-medium">{formatDate(ts.week_ending)}</td>
                      <td className="capitalize">{ts.period_type}</td>
                      <td>{ts.total_hours.toFixed(2)} hrs</td>
                      <td>{getStatusBadge(ts.status)}</td>
                      <td>
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
