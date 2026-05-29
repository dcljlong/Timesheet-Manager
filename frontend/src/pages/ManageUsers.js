import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, Trash2, UserPlus, Users } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";

export default function ManageUsers() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingPayrollUserId, setSavingPayrollUserId] = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "employee"
  });

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

  const handleNewUserFieldChange = (field, value) => {
    setNewUser((current) => ({ ...current, [field]: value }));
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();

    const payload = {
      name: newUser.name.trim(),
      email: newUser.email.trim().toLowerCase(),
      password: newUser.password,
      role: newUser.role || "employee"
    };

    if (!payload.name || !payload.email || !payload.password) {
      toast.error("Name, email, and temporary password are required");
      return;
    }

    if (payload.password.length < 8) {
      toast.error("Temporary password must be at least 8 characters");
      return;
    }

    setCreatingUser(true);

    try {
      const { data } = await axios.post(`${API}/users`, payload, { withCredentials: true });
      setUsers((current) => [data, ...current]);
      setNewUser({
        name: "",
        email: "",
        password: "",
        role: "employee"
      });
      setShowAddUser(false);
      toast.success("User created");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setCreatingUser(false);
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

  const handlePayrollFieldChange = (userId, field, value) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, [field]: value } : u)));
  };

  const handleSavePayrollSettings = async (userId) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return;

    setSavingPayrollUserId(userId);
    try {
      await axios.put(`${API}/users/${userId}/payroll-settings`, {
        smartly_employee_code: targetUser.smartly_employee_code || "",
        smartly_pay_group: targetUser.smartly_pay_group || "",
        payroll_treatment: targetUser.payroll_treatment || "payroll_employee",
        smartly_costing_mode: targetUser.smartly_costing_mode || "define_now",
        smartly_has_standard_hours: targetUser.smartly_has_standard_hours !== false
      }, { withCredentials: true });
      toast.success("Payroll settings updated");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSavingPayrollUserId(null);
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

        <div className="mb-4 flex justify-end">
          <Button
            type="button"
            onClick={() => setShowAddUser((current) => !current)}
            data-testid="add-user-toggle"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            {showAddUser ? "Cancel" : "Add User"}
          </Button>
        </div>

        {showAddUser && (
          <form className="card mb-6 p-4" onSubmit={handleCreateUser} data-testid="add-user-panel">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
              <p className="text-sm text-gray-500">
                Create an admin-controlled login. Public registration remains disabled.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <Input
                  value={newUser.name}
                  onChange={(e) => handleNewUserFieldChange("name", e.target.value)}
                  placeholder="Staff name"
                  autoComplete="name"
                  data-testid="new-user-name"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => handleNewUserFieldChange("email", e.target.value)}
                  placeholder="staff@example.co.nz"
                  autoComplete="email"
                  data-testid="new-user-email"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Temporary Password</label>
                <Input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => handleNewUserFieldChange("password", e.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  data-testid="new-user-password"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                <Select
                  value={newUser.role}
                  onValueChange={(value) => handleNewUserFieldChange("role", value)}
                >
                  <SelectTrigger data-testid="new-user-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="project_manager">Project Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={creatingUser} data-testid="create-user-submit">
                {creatingUser ? "Creating..." : "Create User"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddUser(false)}
                disabled={creatingUser}
                data-testid="create-user-cancel"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
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
                      <th>Smartly Code</th>
                      <th>Pay Group</th>
                      <th>Payroll Treatment</th>
                      <th>Costing Mode</th>
                      <th>Std Hours</th>
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
                        <td>
                          <Input
                            value={u.smartly_employee_code || ""}
                            onChange={(e) => handlePayrollFieldChange(u.id, "smartly_employee_code", e.target.value)}
                            className="h-8 w-28"
                          />
                        </td>
                        <td>
                          <Input
                            value={u.smartly_pay_group || ""}
                            onChange={(e) => handlePayrollFieldChange(u.id, "smartly_pay_group", e.target.value)}
                            className="h-8 w-24"
                          />
                        </td>
                        <td>
                          <Select
                            value={u.payroll_treatment || "payroll_employee"}
                            onValueChange={(v) => handlePayrollFieldChange(u.id, "payroll_treatment", v)}
                          >
                            <SelectTrigger className="w-40 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="payroll_employee">Payroll Employee</SelectItem>
                              <SelectItem value="hold_from_export">Hold From Export</SelectItem>
                              <SelectItem value="contractor_verify_only">Contractor Verify Only</SelectItem>
                              <SelectItem value="contractor_in_smartly">Contractor In Smartly</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td>
                          <Select
                            value={u.smartly_costing_mode || "define_now"}
                            onValueChange={(v) => handlePayrollFieldChange(u.id, "smartly_costing_mode", v)}
                          >
                            <SelectTrigger className="w-36 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="define_now">Define Now</SelectItem>
                              <SelectItem value="enter_at_pay_time">Enter At Pay Time</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={u.smartly_has_standard_hours !== false}
                            onChange={(e) => handlePayrollFieldChange(u.id, "smartly_has_standard_hours", e.target.checked)}
                          />
                        </td>
                      <td className="text-gray-500">
                        {u.created_at ? format(new Date(u.created_at), "d MMM yyyy") : "-"}
                      </td>
                      <td>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSavePayrollSettings(u.id)}
                            disabled={savingPayrollUserId === u.id}
                            className="mr-2"
                          >
                            {savingPayrollUserId === u.id ? "Saving..." : "Save Payroll"}
                          </Button>
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
