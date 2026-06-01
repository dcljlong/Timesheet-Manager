import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { ArrowLeft, Download, CheckCircle, XCircle, Edit, Trash2 } from "lucide-react";
import { format } from "date-fns";
import Layout from "../components/Layout";
import SignaturePad from "../components/SignaturePad";

export default function TimesheetView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [timesheet, setTimesheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectManagers, setPMs] = useState([]);
  const [approving, setApproving] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [pmSignature, setPmSignature] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // TIMESHEET REJECTED OPEN RESILIENCE V1
      // Load the timesheet first. PM reference names are helpful but must not block employees opening rejected timesheets.
      const tsRes = await axios.get(`${API}/timesheets/${id}`, { withCredentials: true });
      setTimesheet(tsRes.data);

      try {
        const pmsRes = await axios.get(`${API}/project-managers`, { withCredentials: true });
        setPMs(pmsRes.data || []);
      } catch (pmErr) {
        console.warn("Project manager reference list failed; showing timesheet without PM names", pmErr);
        setPMs([]);
      }
    } catch (err) {
      toast.error(formatApiError(err, "Failed to load timesheet"));
      setTimesheet(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getPmName = (pmId) => {
    const pm = projectManagers.find(p => p.id === pmId);
    return pm ? `${pm.initials} - ${pm.name}` : pmId;
  };

  const getStatusBadge = (status) => {
    const badges = {
      submitted: "badge badge-submitted",
      pm_approved: "badge badge-pm-approved",
      approved: "badge badge-approved",
      rejected: "badge badge-rejected"
    };
    const labels = {
      submitted: "Pending PM Approval",
      pm_approved: "Pending Admin Approval",
      approved: "Approved",
      rejected: "Not Approved"
    };
    return <span className={badges[status] || "badge"}>{labels[status] || status}</span>;
  };

  const canPMApprove = () => {
    if (!timesheet) return false;
    return (user?.role === "project_manager" || user?.role === "admin") && 
           timesheet.status === "submitted";
  };

  const canAdminApprove = () => {
    if (!timesheet) return false;
    return user?.role === "admin" && timesheet.status === "pm_approved";
  };

    const getCalculatedTotalHours = () => {
      if (!timesheet?.days) return 0;
      return timesheet.days.reduce((sum, day) => {
        return sum + (day.entries || []).reduce((entrySum, entry) => {
          return entrySum + (parseFloat(entry.total_hours) || 0);
        }, 0);
      }, 0);
    };

  const formatEntryTypeLabel = (type) => {
    const normalised = String(type || "work").trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (normalised === "unpaid_day_off") return "No Work";
    if (normalised === "public_holiday") return "Public Holiday";
    if (normalised === "annual_leave") return "Annual Leave";
    if (normalised === "sick") return "Sick";
    return "Work";
  };
  const handlePMApprove = async () => {
    if (!pmSignature) {
      toast.error("Please sign before approving");
      return;
    }
    setApproving(true);
    try {
      await axios.post(`${API}/timesheets/${id}/pm-approve`, {
        action: "approve",
        signature: pmSignature
      }, { withCredentials: true });
      toast.success("Timesheet approved");
      setShowApproveModal(false);
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setApproving(false);
    }
  };

  const handleAdminApprove = async () => {
    setApproving(true);
    try {
      await axios.post(`${API}/timesheets/${id}/admin-approve`, {
        action: "approve"
      }, { withCredentials: true });
      toast.success("Timesheet fully approved");
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setApproving(true);
    try {
      const endpoint = user?.role === "admin" && timesheet.status === "pm_approved" 
        ? "admin-approve" 
        : "pm-approve";
      await axios.post(`${API}/timesheets/${id}/${endpoint}`, {
        action: "reject",
        comment: rejectComment
      }, { withCredentials: true });
      toast.success("Timesheet marked as not approved");
      setShowRejectModal(false);
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setApproving(false);
    }
  };

  const canDeleteRejectedTimesheet = () => {
    if (!timesheet) return false;
    return user?.role === "admin" && timesheet.status === "rejected";
  };

  const handleDeleteRejectedTimesheet = async () => {
    const ok = window.confirm(
      "Delete this rejected timesheet? This only removes a rejected, unprocessed review record. Processed/exported timesheets need an adjustment instead."
    );

    if (!ok) return;

    setDeleting(true);
    try {
      await axios.delete(`${API}/timesheets/${id}`, { withCredentials: true });
      toast.success("Rejected timesheet deleted");
      navigate("/admin");
    } catch (err) {
      toast.error(formatApiError(err, "Delete failed"));
    } finally {
      setDeleting(false);
    }
  };

  const exportPDF = () => {
    // Print-friendly version
    window.print();
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

  if (!timesheet) return null;

  return (
    <Layout>
      <div className="fade-in print:p-0" data-testid="timesheet-view">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 print:hidden">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="view-title">
                Timesheet Summary
              </h1>
              <p className="text-gray-500">{timesheet.employee_name}</p>
            </div>
          </div>
          <div className="flex space-x-2">
            {/* TIMESHEET REJECTED EMPLOYEE EDIT RULE V1 */}
            {(
              (timesheet.user_id === user?.id && timesheet.status === "rejected") ||
              (user?.role === "project_manager" && (timesheet.status === "submitted" || timesheet.status === "rejected")) ||
              (user?.role === "admin" && (timesheet.status === "submitted" || timesheet.status === "rejected"))
            ) && (
              <Button variant="outline" onClick={() => navigate(`/timesheet/${id}/edit`)} data-testid="edit-button">
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
            {canDeleteRejectedTimesheet() && (
              <Button
                variant="outline"
                onClick={handleDeleteRejectedTimesheet}
                className="text-red-600 border-red-300 hover:bg-red-50"
                disabled={deleting}
                data-testid="delete-rejected-timesheet-button"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deleting ? "Deleting..." : "Delete rejected"}
              </Button>
            )}
            <Button variant="outline" onClick={exportPDF} data-testid="export-button">
              <Download className="w-4 h-4 mr-2" />
              Print/PDF
            </Button>
          </div>
        </div>

        {/* Timesheet Card */}
        <div className="card p-6 mb-5 print:shadow-none print:border-2">
          {/* Header Info */}
          <div className="flex flex-wrap justify-between items-start mb-5 pb-4 border-b">
            <div>
              <h2 className="text-xl font-bold">Timesheet</h2>
              <p className="text-gray-600">Employee: <span className="font-medium">{timesheet.employee_name}</span></p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Week Ending</p>
              <p className="text-lg font-bold">{format(new Date(timesheet.week_ending), "EEEE, d MMMM yyyy")}</p>
              <div className="mt-2">{getStatusBadge(timesheet.status)}</div>
            </div>
          </div>

          {Array.isArray(timesheet.pm_edit_history) && timesheet.pm_edit_history.length > 0 ? (
            <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded">
              <p className="font-medium text-amber-800 mb-2">PM Edit History</p>
              <div className="space-y-3">
                {timesheet.pm_edit_history.map((item, idx) => (
                  <div
                    key={`pm-edit-history-${idx}`}
                    className={idx > 0 ? "pt-3 border-t border-amber-200" : ""}
                  >
                    <p className="font-medium text-amber-800">
                      {item.edited_name || "Project Manager"}
                    </p>
                    <p className="text-xs text-amber-700 mb-1">
                      {item.edited_at ? format(new Date(item.edited_at), "d MMM yyyy h:mm a") : ""}
                    </p>
                    <p className="text-amber-700">{item.reason || "-"}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            (timesheet.pm_last_edited_at || timesheet.pm_edit_reason) && (
              <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded">
                <p className="font-medium text-amber-800">
                  Edited by PM{timesheet.pm_last_edited_name ? `: ${timesheet.pm_last_edited_name}` : ""}
                </p>
                <p className="text-amber-700">{timesheet.pm_edit_reason || "Timesheet updated by PM."}</p>
              </div>
            )
          )}

          {/* Rejection Comment */}
          {timesheet.status === "rejected" && timesheet.rejection_comment && (
            <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded">
              <p className="font-medium text-red-800">Not Approved Reason:</p>
              <p className="text-red-700">{timesheet.rejection_comment}</p>
            </div>
          )}

          {/* Timesheet Grid */}
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
              <thead>
                <tr className="bg-gray-100 text-gray-700 uppercase text-xs tracking-wide">
                  <th className="p-2 border text-left font-semibold">Day</th>
                  <th className="p-2 border text-left font-semibold">Type</th>
                  <th className="p-2 border text-left font-semibold">Start</th>
                  <th className="p-2 border text-left font-semibold">Lunch</th>
                  <th className="p-2 border text-left font-semibold">Finish</th>
                  <th className="p-2 border text-left font-semibold">Hours</th>
                  <th className="p-2 border text-left font-semibold">Job No.</th>
                  <th className="p-2 border text-left font-semibold">Code</th>
                  <th className="p-2 border text-left font-semibold">PM</th>
                  <th className="p-2 border text-left font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {timesheet.days.map((day, dayIndex) => (
                  day.entries.map((entry, entryIndex) => (
                    <tr key={`${dayIndex}-${entryIndex}`} className="hover:bg-gray-50">
                      {entryIndex === 0 && (
                        <td className="p-2 border font-medium bg-gray-50" rowSpan={day.entries.length}>
                          {day.day}
                        </td>
                      )}
                      <td className="px-3 py-2 border border-gray-200 font-medium">{formatEntryTypeLabel(entry.type)}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.start_time || "-"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.lunch_duration ? `${entry.lunch_duration}m` : "-"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.finish_time || "-"}</td>
                      <td className="p-2 border font-medium">{entry.total_hours?.toFixed(2) || "0.00"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.job_number || "-"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.task_code || "-"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.project_manager_id ? getPmName(entry.project_manager_id) : "-"}</td>
                      <td className="px-3 py-2 border border-gray-200">{entry.description || entry.other || "-"}</td>
                    </tr>
                  ))
                ))}
                <tr className="bg-gray-900 text-white font-bold">
                  <td colSpan="5" className="p-3 border text-right">TOTAL HOURS:</td>
                  <td className="p-3 border text-lg" data-testid="view-total-hours">{getCalculatedTotalHours().toFixed(2)}</td>
                  <td colSpan="4" className="p-3 border"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Additional Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <p className="text-sm text-gray-500 mb-1">Messages / Notes</p>
              <p className="p-3 bg-gray-50 rounded min-h-[60px]">{timesheet.messages || "No messages"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-1">Nights Away</p>
              <p className="p-3 bg-gray-50 rounded">{timesheet.nights_away || 0}</p>
            </div>
          </div>

          {/* Signatures Section */}
          <div className="border-t pt-6">
            <h3 className="font-semibold mb-4">Signatures</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Employee Signature */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Employee Signature</p>
                {timesheet.employee_signature ? (
                  <div className="border rounded p-2 bg-white">
                    <img 
                      src={timesheet.employee_signature} 
                      alt="Employee signature" 
                      className="max-h-24 w-auto"
                      data-testid="employee-signature-img"
                    />
                  </div>
                ) : (
                  <div className="border rounded p-4 text-gray-400 text-center">Not signed</div>
                )}
              </div>

              {/* PM Signatures */}
              {timesheet.pm_signatures && timesheet.pm_signatures.length > 0 ? (
                timesheet.pm_signatures.map((sig, idx) => (
                  <div key={idx}>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      PM Signature ({sig.pm_name})
                    </p>
                    <div className="border rounded p-2 bg-white">
                      <img 
                        src={sig.signature} 
                        alt={`${sig.pm_name} signature`} 
                        className="max-h-24 w-auto"
                        data-testid={`pm-signature-img-${idx}`}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Signed: {format(new Date(sig.signed_at), "PPp")}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">PM Signature</p>
                  <div className="border rounded p-4 text-gray-400 text-center">Awaiting approval</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Approval Actions */}
        {(canPMApprove() || canAdminApprove()) && (
          <div className="card p-6 print:hidden" data-testid="approval-actions">
            <h3 className="font-semibold mb-4">Approval Actions</h3>
            <div className="flex space-x-4">
              {canPMApprove() && (
                <Button
                  onClick={() => setShowApproveModal(true)}
                  className="bg-green-600 hover:bg-green-700"
                  disabled={approving}
                  data-testid="pm-approve-button"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve as PM
                </Button>
              )}
              {canAdminApprove() && (
                <Button
                  onClick={handleAdminApprove}
                  className="bg-green-600 hover:bg-green-700"
                  disabled={approving}
                  data-testid="admin-approve-button"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Admin Approval
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowRejectModal(true)}
                className="text-red-600 border-red-300 hover:bg-red-50"
                disabled={approving}
                data-testid="reject-button"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* PM Approve Modal with Signature */}
        {showApproveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="approve-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Sign to Approve</h3>
              <SignaturePad
                label="Your Signature"
                onSignatureChange={setPmSignature}
              />
              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowApproveModal(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handlePMApprove} 
                  className="bg-green-600 hover:bg-green-700"
                  disabled={approving || !pmSignature}
                  data-testid="confirm-approve-button"
                >
                  {approving ? "Approving..." : "Approve"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="reject-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Reject Timesheet</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for rejection
                </label>
                <Textarea
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="Please provide a reason..."
                  rows={3}
                  data-testid="reject-comment-input"
                />
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowRejectModal(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleReject}
                  className="bg-red-600 hover:bg-red-700"
                  disabled={approving || !rejectComment.trim()}
                  data-testid="confirm-reject-button"
                >
                  {approving ? "Rejecting..." : "Reject"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:border-2 { border-width: 2px !important; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </Layout>
  );
}










