import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ArrowLeft, Plus, Trash2, Layers } from "lucide-react";
import Layout from "../components/Layout";

export default function ManageTaskCodes() {
  const navigate = useNavigate();
  const [taskCodes, setTaskCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingTaskCodeId, setSavingTaskCodeId] = useState(null);

  useEffect(() => {
    fetchTaskCodes();
  }, []);

  const fetchTaskCodes = async () => {
    try {
      const { data } = await axios.get(`${API}/task-codes`, { withCredentials: true });
      setTaskCodes(data);
    } catch (err) {
      toast.error("Failed to load task codes");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newCode.trim() || !newDesc.trim()) {
      toast.error("Please fill in both fields");
      return;
    }
    setAdding(true);
    try {
      const { data } = await axios.post(`${API}/task-codes`, {
        code: newCode,
        description: newDesc
      }, { withCredentials: true });
      setTaskCodes([...taskCodes, data]);
      setNewCode("");
      setNewDesc("");
      setShowAdd(false);
      toast.success("Task code added");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleFieldChange = (id, field, value) => {
    setTaskCodes((prev) => prev.map((tc) => (tc.id === id ? { ...tc, [field]: value } : tc)));
  };

  const handleSaveSmartlySettings = async (id) => {
    const target = taskCodes.find((tc) => tc.id === id);
    if (!target) return;

    setSavingTaskCodeId(id);
    try {
      await axios.put(`${API}/task-codes/${id}/smartly-settings`, {
        smartly_department_quick_code: target.smartly_department_quick_code || "",
        smartly_export_enabled: target.smartly_export_enabled !== false
      }, { withCredentials: true });
      toast.success("Task code Smartly settings updated");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSavingTaskCodeId(null);
    }
  };

  const handleDelete = async (id, code) => {
    if (!window.confirm(`Delete task code "${code}"?`)) return;
    try {
      await axios.delete(`${API}/task-codes/${id}`, { withCredentials: true });
      setTaskCodes(taskCodes.filter(tc => tc.id !== id));
      toast.success("Task code deleted");
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
      <div className="fade-in" data-testid="manage-task-codes">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="page-title">
                Task Codes
              </h1>
              <p className="text-gray-500">Manage analysis codes for timesheets</p>
            </div>
          </div>
          <Button onClick={() => setShowAdd(true)} className="bg-gray-900 hover:bg-gray-800" data-testid="add-code-button">
            <Plus className="w-4 h-4 mr-2" />
            Add Code
          </Button>
        </div>

        {/* Task Codes List */}
        <div className="card" data-testid="task-codes-list">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                    <th>Smartly Dept Code</th>
                    <th>Export</th>
                    <th>Save</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {taskCodes.map((tc) => (
                  <tr key={tc.id} data-testid={`code-row-${tc.id}`}>
                    <td className="font-medium">{tc.code}</td>
                    <td>{tc.description}</td>
                      <td>
                        <Input
                          value={tc.smartly_department_quick_code || ""}
                          onChange={(e) => handleFieldChange(tc.id, "smartly_department_quick_code", e.target.value)}
                          className="h-8 w-36"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={tc.smartly_export_enabled !== false}
                          onChange={(e) => handleFieldChange(tc.id, "smartly_export_enabled", e.target.checked)}
                        />
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSaveSmartlySettings(tc.id)}
                          disabled={savingTaskCodeId === tc.id}
                        >
                          {savingTaskCodeId === tc.id ? "Saving..." : "Save"}
                        </Button>
                      </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(tc.id, tc.code)}
                        className="text-red-500 hover:text-red-700"
                        data-testid={`delete-code-${tc.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add Modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="add-code-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Add New Task Code</h3>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="e.g., 120"
                    className="mt-1"
                    data-testid="new-code-input"
                  />
                </div>
                <div>
                  <Label htmlFor="desc">Description</Label>
                  <Input
                    id="desc"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g., Scaffolding"
                    className="mt-1"
                    data-testid="new-desc-input"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} className="bg-gray-900 hover:bg-gray-800" disabled={adding} data-testid="save-code-button">
                  {adding ? "Adding..." : "Add Code"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
