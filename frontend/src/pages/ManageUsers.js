import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, Mail, Trash2, UserPlus, Users } from "lucide-react";
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

  const handleInviteUser = (targetUser) => {
    const email = (targetUser?.email || "").trim();

    if (!email) {
      toast.error("User email is required before sending an invite");
      return;
    }

    const fullName = (targetUser?.name || "there").trim() || "there";
    const firstName = fullName === "there" ? "there" : fullName.split(/\s+/)[0];
    const subject = encodeURIComponent("Timesheet Manager access");
    const body = encodeURIComponent([
      `Hi ${firstName},`,
      "",
      "You have been added to Timesheet Manager.",
      "",
      "Open the app here:",
      "https://timesheet-manager-two.vercel.app",
      "",
      `Your login email is: ${email}`,
      "Your temporary password will be provided separately.",
      "",
      "Save it to your phone:",
      "iPhone: open the link in Safari, tap Share, then Add to Home Screen.",
      "Android: open the link in Chrome, tap the three-dot menu, then Add to Home screen or Install app.",
      "",
      "Use Timesheet Manager for real work time only. Please do not enter test rows.",
      "Check the job, task code, start time, finish time, and lunch break before submitting.",
      "",
      "If something is wrong, let David know rather than deleting or working around it.",
      "",
      "Thanks"
    ].join("\n"));

    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    toast.success("Invite email draft opened - send it from your email app, then confirm first login manually");
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
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm sm:p-5" data-testid="users-page-header-polished">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Button variant="ghost" onClick={() => navigate(-1)} className="mt-1 shrink-0" data-testid="back-button">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Admin Controls</p>
                <h1 className="text-3xl font-extrabold tracking-tight text-gray-950" data-testid="page-title">
                  Manage Users
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-gray-600">
                  Create staff logins, control roles, and maintain payroll export details before loading the full team. Invite opens an email draft; acceptance/first login is not tracked yet, so confirm setup manually.
                </p>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => setShowAddUser((current) => !current)}
              className="w-full justify-center lg:w-auto"
              data-testid="add-user-toggle"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              {showAddUser ? "Cancel" : "Add User"}
            </Button>
          </div>
        </div>



        {showAddUser && (
          <form className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm sm:p-5" onSubmit={handleCreateUser} data-testid="add-user-panel">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-gray-950">Add User</h2>
              <p className="text-sm text-gray-500">
                Create an admin-controlled login. Public registration remains disabled.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        <div className="card overflow-hidden border border-gray-200 shadow-sm" data-testid="users-list">
          <div className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-950">Staff / User Accounts</h2>
              <p className="text-sm text-gray-600">Use the scrollable payroll table for Smartly details. Create and prove staff one at a time before bulk loading.</p>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-600">
              {users.length} users
            </span>
          </div>
          {users.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1280px] text-sm">
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
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleInviteUser(u)}
                            className="mr-2"
                            data-testid={`invite-user-${u.id}`}
                          >
                            <Mail className="mr-1 h-4 w-4" />
                            Open Invite Email
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
