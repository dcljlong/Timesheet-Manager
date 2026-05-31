import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ArrowLeft, Plus, Trash2, Briefcase } from "lucide-react";
import Layout from "../components/Layout";

export default function ManageJobNumbers() {
  const navigate = useNavigate();
  const [jobNumbers, setJobNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newJobNumber, setNewJobNumber] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchJobNumbers();
  }, []);

  const fetchJobNumbers = async () => {
    try {
      const { data } = await axios.get(`${API}/job-numbers`, { withCredentials: true });
      setJobNumbers(data || []);
    } catch (err) {
      toast.error("Failed to load job numbers");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newJobNumber.trim()) {
      toast.error("Job number is required");
      return;
    }

    setAdding(true);
    try {
      const { data } = await axios.post(`${API}/job-numbers`, {
        job_number: newJobNumber.trim(),
        description: newDesc.trim(),
        active: true
      }, { withCredentials: true });

      setJobNumbers((prev) => [...prev, data].sort((a, b) => a.job_number.localeCompare(b.job_number)));
      setNewJobNumber("");
      setNewDesc("");
      setShowAdd(false);
      toast.success("Job number added");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, jobNumber) => {
    if (!window.confirm(`Delete job number "${jobNumber}"? Existing timesheets keep their saved job number.`)) return;

    try {
      await axios.delete(`${API}/job-numbers/${id}`, { withCredentials: true });
      setJobNumbers((prev) => prev.filter((job) => job.id !== id));
      toast.success("Job number deleted");
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
      <div className="fade-in" data-testid="job-numbers-page">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="page-title">
                Job Numbers
              </h1>
              <p className="text-gray-500">Manage job numbers available for timesheet entry</p>
            </div>
          </div>
          <Button onClick={() => setShowAdd(true)} className="bg-gray-900 hover:bg-gray-800" data-testid="add-job-number-button">
            <Plus className="w-4 h-4 mr-2" />
            Add Job Number
          </Button>
        </div>

        <div className="card" data-testid="job-numbers-list">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job Number</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobNumbers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center text-gray-500 py-8">
                      No job numbers added yet.
                    </td>
                  </tr>
                ) : (
                  jobNumbers.map((job) => (
                    <tr key={job.id} data-testid={`job-number-row-${job.id}`}>
                      <td className="font-medium">{job.job_number}</td>
                      <td>{job.description || "-"}</td>
                      <td>{job.active === false ? "Inactive" : "Active"}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(job.id, job.job_number)}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`delete-job-number-${job.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="add-job-number-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center mb-4">
                <Briefcase className="w-5 h-5 mr-2" />
                <h3 className="text-lg font-bold">Add Job Number</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="jobNumber">Job Number</Label>
                  <Input
                    id="jobNumber"
                    value={newJobNumber}
                    onChange={(e) => setNewJobNumber(e.target.value)}
                    placeholder="e.g., 4154"
                    className="mt-1"
                    data-testid="new-job-number-input"
                  />
                </div>
                <div>
                  <Label htmlFor="jobDescription">Description</Label>
                  <Input
                    id="jobDescription"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g., Papamoa Plaza Stage 3"
                    className="mt-1"
                    data-testid="new-job-description-input"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} className="bg-gray-900 hover:bg-gray-800" disabled={adding} data-testid="save-job-number-button">
                  {adding ? "Adding..." : "Add Job Number"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}