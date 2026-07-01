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

  // TIMESHEET MANAGER / COMPACT NO WORK SUMMARY ROWS V3
  // Keep payroll review clean: No Work is a confirmed day state, not a full work-detail row.
  const normaliseEntryTypeForView = (type) => String(type || "work").trim().toLowerCase().replace(/[-\s]+/g, "_");

  const isNoWorkEntryType = (type) => {
    const normalised = normaliseEntryTypeForView(type);
    return normalised === "no_work" || normalised === "unpaid_day_off";
  };

  const formatEntryTypeLabel = (type) => {
    const normalised = normaliseEntryTypeForView(type);
    if (isNoWorkEntryType(normalised)) return "No Work";
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

  if (!timesheet) {
    return (
      <Layout>
        <div className="fade-in" data-testid="timesheet-load-error">
          <div className="card mx-auto max-w-2xl p-6 text-center">
            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              Timesheet could not be opened
            </h1>
            <p className="mb-5 text-sm text-gray-600">
              This timesheet may have been deleted, returned, or your login may not have access. This screen replaces the old blank page so staff can recover safely.
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(-1)}
                data-testid="timesheet-load-back-button"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go Back
              </Button>
              <Button
                type="button"
                onClick={() => navigate(user?.role === "admin" ? "/admin" : user?.role === "project_manager" ? "/pm" : "/")}
                data-testid="timesheet-load-dashboard-button"
              >
                Open Dashboard
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="fade-in print:p-0" data-testid="timesheet-view">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5 print:hidden" data-testid="timesheet-view-header">
          <div className="flex min-w-0 items-start">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-3 shrink-0 px-2 py-2" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight text-gray-900" data-testid="view-title">
                Timesheet Summary
              </h1>
              <p className="truncate text-gray-500">{timesheet.employee_name}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-nowrap sm:justify-end">
            {/* TIMESHEET REJECTED EMPLOYEE EDIT RULE V1 */}
            {(
              (timesheet.user_id === user?.id && timesheet.status === "rejected") ||
              (user?.role === "project_manager" && (timesheet.status === "submitted" || timesheet.status === "rejected")) ||
              (user?.role === "admin" && (timesheet.status === "submitted" || timesheet.status === "rejected"))
            ) && (
              <Button variant="outline" onClick={() => navigate(`/timesheet/${id}/edit`)} className="w-full px-3 py-2 text-sm sm:w-auto" data-testid="edit-button">
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
            {canDeleteRejectedTimesheet() && (
              <Button
                variant="outline"
                onClick={handleDeleteRejectedTimesheet}
                className="w-full px-3 py-2 text-sm text-red-600 border-red-300 hover:bg-red-50 sm:w-auto"
                disabled={deleting}
                data-testid="delete-rejected-timesheet-button"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deleting ? "Deleting..." : (<><span className="sm:hidden">Delete</span><span className="hidden sm:inline">Delete rejected</span></>)}
              </Button>
            )}
            <Button variant="outline" onClick={exportPDF} className="w-full px-3 py-2 text-sm sm:w-auto" data-testid="export-button">
              <Download className="w-4 h-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Timesheet Card */}
        <div className="card p-6 mb-5 print:shadow-none print:border-2" data-testid="timesheet-print-document">
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

          {/* Payroll Audit Trail */}
          {timesheet.rejection_audit_trail && timesheet.rejection_audit_trail.length > 0 && (
            <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded">
              <p className="font-medium text-slate-800 mb-2">Payroll Audit Trail</p>
              <p className="text-sm font-semibold text-slate-700">Rejection history</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {timesheet.rejection_audit_trail.map((entry, index) => (
                  <li key={`rejection-audit-${index}`}>
                    {entry.at || "Unknown time"} - {entry.action || "rejected"} by {entry.by_email || entry.by_name || "unknown"}
                    {entry.comment ? `: ${entry.comment}` : ""}
                  </li>
                ))}
              </ul>
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
                    day.entries.map((entry, entryIndex) => {
                      const isNoWorkRow = isNoWorkEntryType(entry.type);
                      const rowSpan = day.entries.length;

                      if (isNoWorkRow) {
                        return (
                          <tr
                            key={`${dayIndex}-${entryIndex}`}
                            className="bg-emerald-50 hover:bg-emerald-50"
                            data-testid={`compact-no-work-row-${dayIndex}-${entryIndex}`}
                          >
                            {entryIndex === 0 && (
                              <td className="p-2 border font-medium bg-emerald-100 text-emerald-950" rowSpan={rowSpan}>
                                {day.day}
                              </td>
                            )}
                            <td colSpan="9" className="px-3 py-2 border border-emerald-200 text-emerald-900">
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900">
                                No Work confirmed
                              </span>
                              <span className="ml-2 text-xs text-emerald-800">
                                No start, finish, lunch, job, task, or PM required.
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={`${dayIndex}-${entryIndex}`} className="hover:bg-gray-50">
                          {entryIndex === 0 && (
                            <td className="p-2 border font-medium bg-gray-50" rowSpan={rowSpan}>
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
                      );
                    })
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
        /* TIMESHEET MANAGER / PRINT PDF DOCUMENT LAYOUT V3
           Print / Save PDF must output a payroll document, not the live app shell.
           The screen UI remains unchanged; these rules apply only in print preview/PDF.
        */
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          html,
          body,
          #root {
            width: 210mm !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #111827 !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
            overflow: visible !important;
          }

          body * {
            visibility: hidden !important;
          }

          [data-testid="timesheet-print-document"],
          [data-testid="timesheet-print-document"] * {
            visibility: visible !important;
          }

          [data-testid="timesheet-print-document"] {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 194mm !important;
            max-width: 194mm !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            background: #ffffff !important;
            color: #111827 !important;
            font-size: 8.5pt !important;
            line-height: 1.25 !important;
          }

          [data-testid="timesheet-view-header"],
          [data-testid="approval-actions"],
          [data-testid="reject-modal"],
          [data-testid="edit-button"],
          [data-testid="export-button"],
          [data-testid="delete-rejected-timesheet-button"],
          [data-testid="back-button"] {
            display: none !important;
            visibility: hidden !important;
          }

          [data-testid="timesheet-print-document"] h2 {
            font-size: 13pt !important;
            margin: 0 0 2mm 0 !important;
          }

          [data-testid="timesheet-print-document"] h3 {
            font-size: 10pt !important;
            margin: 3mm 0 2mm 0 !important;
          }

          [data-testid="timesheet-print-document"] p,
          [data-testid="timesheet-print-document"] span,
          [data-testid="timesheet-print-document"] div {
            color: #111827 !important;
          }

          [data-testid="timesheet-print-document"] table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 7.3pt !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
          }

          [data-testid="timesheet-print-document"] thead {
            display: table-header-group !important;
          }

          [data-testid="timesheet-print-document"] tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          [data-testid="timesheet-print-document"] th,
          [data-testid="timesheet-print-document"] td {
            padding: 1.4mm 1.6mm !important;
            border: 1px solid #d1d5db !important;
            color: #111827 !important;
            vertical-align: top !important;
          }

          [data-testid="timesheet-print-document"] th {
            background: #111827 !important;
            color: #ffffff !important;
            font-weight: 800 !important;
          }

          [data-testid="timesheet-print-document"] .bg-gray-900,
          [data-testid="timesheet-print-document"] [class*="bg-gray-900"] {
            background: #111827 !important;
            color: #ffffff !important;
          }

          [data-testid="timesheet-print-document"] .bg-emerald-50,
          [data-testid="timesheet-print-document"] [class*="bg-emerald-50"],
          [data-testid="timesheet-print-document"] .bg-emerald-100,
          [data-testid="timesheet-print-document"] [class*="bg-emerald-100"] {
            background: #dcfce7 !important;
            color: #064e3b !important;
          }

          [data-testid="timesheet-print-document"] img {
            max-height: 20mm !important;
            object-fit: contain !important;
            background: #ffffff !important;
          }

          [data-testid="timesheet-print-document"] .grid {
            gap: 4mm !important;
          }

          [data-testid="timesheet-print-document"] .border-t {
            margin-top: 4mm !important;
            padding-top: 3mm !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* TIMESHEET MANAGER / PRINTER FRIENDLY PRINT BANDS V2
             Final print override: table headers and total rows must be ink-light for printer-friendly payroll copies.
          */
          [data-testid="timesheet-print-document"] th,
          [data-testid="timesheet-print-document"] .bg-gray-900,
          [data-testid="timesheet-print-document"] [class*="bg-gray-900"] {
            background: #f3f4f6 !important;
            color: #111827 !important;
          }

          [data-testid="timesheet-print-document"] th {
            border-bottom: 1.5px solid #9ca3af !important;
          }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:border-2 { border-width: 0 !important; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </Layout>
  );
}















