import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, Trash2, Users } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";

export default function ManageUsers() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data } = await axios.get(`${API}/users`, { withCredentials: true });
      setUsers(data);
    } catch (err) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await axios.put(`${API}/users/${userId}/role`, { role: newRole }, { withCredentials: true });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast.success("Role updated");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleDelete = async (userId, name) => {
    if (userId === currentUser?.id) {
      toast.error("You cannot delete yourself");
      return;
    }
    if (!window.confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/users/${userId}`, { withCredentials: true });
      setUsers(users.filter(u => u.id !== userId));
      toast.success("User deleted");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const getRoleBadge = (role) => {
    const colors = {
      admin: "bg-purple-100 text-purple-800",
      project_manager: "bg-blue-100 text-blue-800",
      employee: "bg-gray-100 text-gray-800"
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${colors[role] || colors.employee}`}>
        {role?.replace("_", " ").toUpperCase()}
      </span>
    );
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
      <div className="fade-in" data-testid="manage-users">
        {/* Header */}
        <div className="flex items-center mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="page-title">
              Manage Users
            </h1>
            <p className="text-gray-500">View and manage user accounts and roles</p>
          </div>
        </div>

        {/* Users List */}
        <div className="card" data-testid="users-list">
          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} data-testid={`user-row-${u.id}`}>
                      <td className="font-medium">{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        <Select
                          value={u.role}
                          onValueChange={(v) => handleRoleChange(u.id, v)}
                          disabled={u.id === currentUser?.id}
                        >
                          <SelectTrigger className="w-36" data-testid={`role-select-${u.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="project_manager">Project Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="text-gray-500">
                        {u.created_at ? format(new Date(u.created_at), "d MMM yyyy") : "-"}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(u.id, u.name)}
                          className="text-red-500 hover:text-red-700"
                          disabled={u.id === currentUser?.id}
                          data-testid={`delete-user-${u.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
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
