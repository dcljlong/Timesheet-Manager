import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ArrowLeft, Plus, Trash2, UserCog } from "lucide-react";
import Layout from "../components/Layout";

export default function ManagePMs() {
  const navigate = useNavigate();
  const [pms, setPMs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newInitials, setNewInitials] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchPMs();
  }, []);

  const fetchPMs = async () => {
    try {
      const { data } = await axios.get(`${API}/project-managers`, { withCredentials: true });
      setPMs(data);
    } catch (err) {
      toast.error("Failed to load project managers");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newInitials.trim() || !newName.trim()) {
      toast.error("Please fill in initials and name");
      return;
    }
    setAdding(true);
    try {
      const { data } = await axios.post(`${API}/project-managers`, {
        initials: newInitials,
        name: newName,
        email: newEmail || null
      }, { withCredentials: true });
      setPMs([...pms, data]);
      setNewInitials("");
      setNewName("");
      setNewEmail("");
      setShowAdd(false);
      toast.success("Project Manager added");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete project manager "${name}"?`)) return;
    try {
      await axios.delete(`${API}/project-managers/${id}`, { withCredentials: true });
      setPMs(pms.filter(pm => pm.id !== id));
      toast.success("Project Manager deleted");
    } catch (err) {
      toast.error(formatApiError(err));
    }
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
      <div className="fade-in" data-testid="manage-pms">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="page-title">
                Project Managers
              </h1>
              <p className="text-gray-500">Manage PM list for timesheet assignments</p>
            </div>
          </div>
          <Button onClick={() => setShowAdd(true)} className="bg-gray-900 hover:bg-gray-800" data-testid="add-pm-button">
            <Plus className="w-4 h-4 mr-2" />
            Add PM
          </Button>
        </div>

        {/* PMs List */}
        <div className="card" data-testid="pms-list">
          {pms.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <UserCog className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No project managers yet. Add one to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Initials</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pms.map((pm) => (
                    <tr key={pm.id} data-testid={`pm-row-${pm.id}`}>
                      <td className="font-bold">{pm.initials}</td>
                      <td>{pm.name}</td>
                      <td>{pm.email || "-"}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(pm.id, pm.name)}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`delete-pm-${pm.id}`}
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

        {/* Add Modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="add-pm-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Add Project Manager</h3>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="initials">Initials</Label>
                  <Input
                    id="initials"
                    value={newInitials}
                    onChange={(e) => setNewInitials(e.target.value.toUpperCase())}
                    placeholder="e.g., JD"
                    maxLength={4}
                    className="mt-1"
                    data-testid="pm-initials-input"
                  />
                </div>
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., John Doe"
                    className="mt-1"
                    data-testid="pm-name-input"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email (Optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="e.g., john@company.com"
                    className="mt-1"
                    data-testid="pm-email-input"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    If email matches a user account, they'll see timesheets assigned to them
                  </p>
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} className="bg-gray-900 hover:bg-gray-800" disabled={adding} data-testid="save-pm-button">
                  {adding ? "Adding..." : "Add PM"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
