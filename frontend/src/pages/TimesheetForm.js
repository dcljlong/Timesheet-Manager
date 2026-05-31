import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Calendar } from "../components/ui/calendar";
import { Textarea } from "../components/ui/textarea";
import { Plus, Trash2, CalendarIcon, Save, ArrowLeft } from "lucide-react";
import { format, addDays, startOfWeek, endOfWeek, isSunday, nextSunday, previousSunday } from "date-fns";
import Layout from "../components/Layout";
import SignaturePad from "../components/SignaturePad";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMESHEET_DRAFT_KEY = "timesheet_form_draft_v1";
const DRAFT_DEBUG_KEY = "timesheet_form_draft_v1";

const getDraftKey = (isEditing, id) =>
  isEditing && id ? `${TIMESHEET_DRAFT_KEY}_edit_${id}` : TIMESHEET_DRAFT_KEY;

const emptyEntry = () => ({
  type: "work",
  start_time: "",
  lunch_duration: "",
  finish_time: "",
  total_hours: 0,
  job_number: "",
  task_code: "",
  project_manager_id: "",
  description: "",
  other: ""
});

const initialDays = () => DAYS.map(day => ({ day, entries: [emptyEntry()] }));

const normalizeDays = (incomingDays) => {
  if (!Array.isArray(incomingDays)) return initialDays();

  return DAYS.map((dayName, index) => {
    const existingDay = incomingDays[index];
    const entries = Array.isArray(existingDay?.entries) ? existingDay.entries : [];

    return {
      day: dayName,
      entries: entries.length
        ? entries.map((e) => ({
            type: e.type || "work",
            start_time: e.start_time || "",
            lunch_duration: e.lunch_duration || "",
            finish_time: e.finish_time || "",
            total_hours:
  (e.type && !["public_holiday","annual_leave","sick"].includes(normaliseEntryType(e.type)))
    ? ((e.start_time && e.finish_time) ? parseFloat(e.total_hours || 0) : 0)
    : parseFloat(e.total_hours || 0),
            job_number: e.job_number || "",
            task_code: e.task_code || e.code || "",
            project_manager_id: e.project_manager_id || e.pm_id || e.pm || "",
            description: e.description || e.other || "",
            other: e.other || e.description || "",
          }))
        : [emptyEntry()]
    };
  });
};

export default function TimesheetForm() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const freshStartStamp = location.state?.stamp || 0;
  const isFreshStart = !isEditing && !!location.state?.freshStart;
  const signatureRef = useRef(null);
  const addEntryLockRef = useRef({});
  const draftRef = useRef(null);
  const draftLoadedRef = useRef(false);
  const hasLoadedDraftRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskCodes, setTaskCodes] = useState([]);
  const [jobNumbers, setJobNumbers] = useState([]);
  const [projectManagers, setPMs] = useState([]);
  const [defaults, setDefaults] = useState(null);

  // Form state
  const [employeeName, setEmployeeName] = useState(user?.name || "");
  const [periodType, setPeriodType] = useState("weekly");
  const [weekEnding, setWeekEnding] = useState(null);
  const [days, setDays] = useState(initialDays());
  const [messages, setMessages] = useState("");
  const [nightsAway, setNightsAway] = useState(0);
  const [employeeSignature, setEmployeeSignature] = useState(null);
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCodeValue, setNewCodeValue] = useState("");
  const [newCodeDesc, setNewCodeDesc] = useState("");

  const resetToBlankTimesheet = () => {
    setEmployeeName(user?.name || "");
    setPeriodType("weekly");
    setWeekEnding(null);
    setDays(initialDays());
    setMessages("");
    setNightsAway(0);
    setEmployeeSignature(null);
    if (typeof setPmEditReason === "function") {
      setPmEditReason("");
    }
    draftRef.current = null;
    draftLoadedRef.current = false;
    hasLoadedDraftRef.current = true;
    addEntryLockRef.current = {};
    localStorage.removeItem(getDraftKey(false));
  };
  const [pmEditReason, setPmEditReason] = useState("");
  const isPmEditing = isEditing && user?.role === "project_manager";

  // TEMP submit handler (restore runtime stability)
  
  // ===== RESTORED HELPERS (SAFE) =====

  const getDayTotal = (dayIndex) => {
    return (days[dayIndex]?.entries || []).reduce((sum, e) => sum + (parseFloat(e.total_hours) || 0), 0);
  };

  const getRunningTotal = (dayIndex) => {
    let total = 0;
    for (let i = 0; i <= dayIndex; i++) {
      total += getDayTotal(i);
    }
    return total;
  };

  const getTotalHours = () => {
    return days.reduce((sum, _, i) => sum + getDayTotal(i), 0);
  };

  const getTypeTotalHours = (targetType) => {
    return days.reduce((sum, day) => {
      return sum + (day.entries || []).reduce((entrySum, entry) => {
        const entryType = entry.type || "work";
        return entrySum + (entryType === targetType ? (parseFloat(entry.total_hours) || 0) : 0);
      }, 0);
    }, 0);
  };
  const normaliseEntryType = (type) => {
    const value = String(type || "work").trim().toLowerCase().replace(/[-\s]+/g, "_");

    if (value.includes("public") && value.includes("holiday")) return "public_holiday";
    if ((value.includes("ann") || value.includes("annual")) && value.includes("leave")) return "annual_leave";
    if (value.includes("sick")) return "sick";

    return value;
  };

  const isLeaveType = (type) => {
    return ["public_holiday", "annual_leave", "sick"].includes(normaliseEntryType(type));
  };

  const getDefaultLeaveHours = (dayLabel) => {
    return dayLabel === "Friday" ? 8 : 9;
  };

const updateEntry = (dayIndex, entryIndex, field, value) => {
  setDays(prev => {
    const copy = [...prev];
    const currentDay = copy[dayIndex];
    if (!currentDay || !currentDay.entries[entryIndex]) return prev;

    const entry = { ...currentDay.entries[entryIndex] };
    const dayLabel = currentDay.day || "";

    entry[field] = field === "type" ? normaliseEntryType(value) : value;

    if (field === "description") {
      entry.other = value;
    }

    if (field === "other") {
      entry.description = value;
    }

    if (!entry.type) {
      entry.type = "work";
    }

    if (field === "type") {
      if (isLeaveType(value)) {
        entry.start_time = "";
        entry.lunch_duration = "";
        entry.finish_time = "";
        entry.job_number = "";
        entry.task_code = "";
        entry.project_manager_id = "";
        entry.total_hours = getDefaultLeaveHours(dayLabel);
      } else {
        entry.total_hours = 0;
      }
    }

    if (!isLeaveType(entry.type)) {
      const hasStart = !!entry.start_time;
      const hasFinish = !!entry.finish_time;

      if (hasStart && hasFinish) {
        const start = new Date(`1970-01-01T${entry.start_time}`);
        const end = new Date(`1970-01-01T${entry.finish_time}`);
        const diff = (end.getTime() - start.getTime()) / 1000 / 60 / 60;
        const lunchMinutes = parseFloat(entry.lunch_duration || 0) || 0;
        entry.total_hours = Math.max(0, diff - (lunchMinutes / 60));
      } else {
        entry.total_hours = 0;
      }
    }

    if (isLeaveType(entry.type) && field === "total_hours") {
      entry.total_hours = value === "" ? "" : (parseFloat(value) || 0);
    }

    copy[dayIndex].entries[entryIndex] = entry;
    saveDraftNow({ days: copy });
    return copy;
  });
};

  const addEntry = (dayIndex) => {
    setDays(prev => {
      const currentDay = prev[dayIndex];
      if (!currentDay) return prev;

      const lastEntry = currentDay.entries[currentDay.entries.length - 1];
      const hasBlankLastEntry =
        !lastEntry.start_time &&
        !lastEntry.finish_time &&
        !lastEntry.job_number &&
        !lastEntry.task_code &&
        !lastEntry.project_manager_id &&
        !lastEntry.other;

      if (hasBlankLastEntry) {
        return prev;
      }

      const updated = prev.map((day, idx) =>
        idx === dayIndex
          ? { ...day, entries: [...day.entries, emptyEntry()] }
          : day
      );

      saveDraftNow({ days: updated });
      saveDraftNow(updated);
      return updated;
    });
  };
  const removeEntry = (dayIndex, entryIndex) => {
    setDays(prev => {
      const currentDay = prev[dayIndex];
      if (!currentDay) return prev;

      const nextEntries = currentDay.entries.filter((_, idx) => idx !== entryIndex);
      const safeEntries = nextEntries.length ? nextEntries : [emptyEntry()];

      const updated = prev.map((day, idx) =>
        idx === dayIndex
          ? { ...day, entries: safeEntries }
          : day
      );

      saveDraftNow({ days: updated });
      return updated;
    });
  };

  const startEntryNow = (dayIndex, entryIndex) => {
    updateEntry(dayIndex, entryIndex, "start_time", getCurrentTimeString());
  };

  const finishEntryNow = (dayIndex, entryIndex) => {
    updateEntry(dayIndex, entryIndex, "finish_time", getCurrentTimeString());
  };

  const getCurrentTimeString = () => {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
  };

  const openTimePicker = (testId) => {
    const input = document.querySelector(`[data-testid="${testId}"]`);
    if (!input) return;

    input.focus();

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.click();
  };

  // ===== END RESTORED HELPERS =====

    const saveDraftNow = (override = {}) => {
    try {
      const nextDraft = {
        employee_name: Object.prototype.hasOwnProperty.call(override, "employee_name") ? override.employee_name : employeeName,
        period_type: Object.prototype.hasOwnProperty.call(override, "period_type") ? override.period_type : periodType,
        week_ending: Object.prototype.hasOwnProperty.call(override, "week_ending")
          ? (override.week_ending ? override.week_ending.toISOString() : null)
          : (weekEnding ? weekEnding.toISOString() : null),
        days: Object.prototype.hasOwnProperty.call(override, "days") ? override.days : days,
        messages: Object.prototype.hasOwnProperty.call(override, "messages") ? override.messages : messages,
        nights_away: Object.prototype.hasOwnProperty.call(override, "nights_away")
          ? (parseInt(override.nights_away, 10) || 0)
          : (parseInt(nightsAway, 10) || 0),
        employee_signature: Object.prototype.hasOwnProperty.call(override, "employee_signature")
          ? override.employee_signature
          : employeeSignature
      };

      draftRef.current = nextDraft;
      localStorage.setItem(getDraftKey(isEditing, id), JSON.stringify(nextDraft));
    } catch (e) {
      console.error("Draft save failed", e);
    }
  };

  useEffect(() => {
    if (!isFreshStart) return;

    const draftKey = getDraftKey(false);
    localStorage.removeItem(draftKey);

    draftRef.current = null;
    draftLoadedRef.current = true;
    hasLoadedDraftRef.current = true;
    addEntryLockRef.current = {};

    setEmployeeName(user?.name || "");
    setPeriodType("weekly");
    setWeekEnding(null);
    setDays(initialDays());
    setMessages("");
    setNightsAway(0);
    setEmployeeSignature(null);

    if (typeof setPmEditReason === "function") {
      setPmEditReason("");
    }

    if (signatureRef.current && typeof signatureRef.current.clear === "function") {
      signatureRef.current.clear();
    }
  }, [isFreshStart, freshStartStamp, user]);

  useEffect(() => {
  if (draftLoadedRef.current) return;

  const draftKey = getDraftKey(isEditing, id);

  if (isFreshStart) {
    localStorage.removeItem(draftKey);
    draftRef.current = null;
    draftLoadedRef.current = true;
    hasLoadedDraftRef.current = true;
    return;
  }

  try {
    const raw = localStorage.getItem(draftKey);

    if (raw) {
      const draft = JSON.parse(raw);

      setEmployeeName(draft.employee_name || "");
      setPeriodType(draft.period_type || "weekly");
      setWeekEnding(draft.week_ending ? new Date(draft.week_ending) : null);
      setDays(normalizeDays(draft.days));
      setMessages(draft.messages || "");
      setNightsAway(draft.nights_away || 0);
      setEmployeeSignature(draft.employee_signature || null);

      draftLoadedRef.current = true;
      return;
    }
  } catch (e) {
    console.error("Draft load failed", e);
  }

  if (!isEditing || !id) {
    draftLoadedRef.current = true;
    return;
  }

  const loadTimesheet = async () => {
    try {
      setLoading(true);

      const res = await axios.get(`${API}/timesheets/${id}`, { withCredentials: true });
      const ts = res.data || {};

      setEmployeeName(ts.employee_name || user?.name || "");
      setPeriodType(ts.period_type || "weekly");
      setWeekEnding(ts.week_ending ? new Date(ts.week_ending) : null);
      setDays(normalizeDays(ts.days));
      setMessages(ts.messages || "");
      setNightsAway(ts.nights_away || 0);
      setEmployeeSignature(ts.employee_signature || null);
      setPmEditReason("");

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      draftLoadedRef.current = true;
    }
  };

  loadTimesheet();

}, [isEditing, id, user]);

const handleSubmit = async (e) => {
  e.preventDefault();

  try {
    setSaving(true);

    const cleanedDays = days
      .map((day) => ({
        ...day,
        entries: (day.entries || []).filter((entry) => {
          const type = normaliseEntryType(entry.type || "work");
          if (isLeaveType(type)) {
            return (parseFloat(entry.total_hours) || 0) > 0;
          }
          return (
            entry.start_time &&
            entry.finish_time &&
            (parseFloat(entry.total_hours) || 0) > 0
          );
        })
      }))
      .filter((day) => day.entries.length > 0);

    if (!cleanedDays.length) {
      toast.error("No valid time entries");
      return;
    }

    if (!weekEnding) {
      toast.error("Week ending date is required");
      return;
    }

    const hasEntryValue = (value) =>
      value !== null && value !== undefined && String(value).trim() !== "";

    const requiredWorkFields = [
      ["start_time", "Start time"],
      ["lunch_duration", "Lunch"],
      ["finish_time", "Finish time"],
      ["job_number", "Job number"],
      ["task_code", "Task code"],
      ["project_manager_id", "Project manager"]
    ];

    const leaveEntryMissingHours = days
      .flatMap((day) => (day.entries || []).map((entry) => ({ day: day.day, entry })))
      .find(({ entry }) => isLeaveType(entry.type || "work") && (parseFloat(entry.total_hours) || 0) <= 0);

    if (leaveEntryMissingHours) {
      toast.error(`Leave hours are required on ${leaveEntryMissingHours.day}`);
      return;
    }

    const incompleteWorkEntry = days
      .flatMap((day) => (day.entries || []).map((entry) => ({ day: day.day, entry })))
      .find(({ entry }) => {
        if (isLeaveType(normaliseEntryType(entry.type || "work"))) return false;

        const rowHasAnyValue =
          requiredWorkFields.some(([field]) => hasEntryValue(entry[field])) ||
          (parseFloat(entry.total_hours) || 0) > 0;

        if (!rowHasAnyValue) return false;

        const missingRequiredField = requiredWorkFields.some(([field]) => !hasEntryValue(entry[field]));
        const missingHours = (parseFloat(entry.total_hours) || 0) <= 0;

        return missingRequiredField || missingHours;
      });

    if (incompleteWorkEntry) {
      const missingField = requiredWorkFields.find(([field]) => !hasEntryValue(incompleteWorkEntry.entry[field]));
      if (missingField) {
        toast.error(`${missingField[1]} is required for work entry on ${incompleteWorkEntry.day}`);
      } else {
        toast.error(`Hours are required for work entry on ${incompleteWorkEntry.day}`);
      }
      return;
    }

    if (!isPmEditing && !employeeSignature) {
      toast.error("Employee signature is required");
      return;
    }

    if (isPmEditing && !(pmEditReason || "").trim()) {
      toast.error("PM edit reason is required");
      return;
    }

    const payload = {
      week_ending: new Date(weekEnding).toISOString().split("T")[0],
      period_type: periodType,
      employee_name: employeeName || user?.name || "",
      days: cleanedDays,
      messages,
      nights_away: parseInt(nightsAway, 10) || 0,
      total_hours: getTotalHours(),
      employee_signature: employeeSignature,
      pm_edit_reason: isPmEditing ? (pmEditReason || "").trim() : undefined
    };

    if (isEditing && id) {
      await axios.put(`${API}/timesheets/${id}`, payload, { withCredentials: true });
      toast.success("Timesheet updated");
    } else {
      await axios.post(`${API}/timesheets`, payload, { withCredentials: true });
      toast.success("Timesheet submitted");
    }

    localStorage.removeItem(getDraftKey(isEditing, id));
    navigate(-1);
  } catch (err) {
    console.error(err);
    saveDraftNow();
    toast.error(
      formatApiError(
        err,
        isEditing ? "Update failed - draft kept" : "Submit failed - draft kept"
      )
    );
  } finally {
    setSaving(false);
  }
};

  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        setLoading(true);

        const [codesRes, pmRes, jobsRes] = await Promise.all([
          axios.get(`${API}/task-codes`),
          axios.get(`${API}/project-managers`),
          axios.get(`${API}/job-numbers`)
        ]);

        setTaskCodes(codesRes.data || []);
        setJobNumbers((jobsRes.data || []).filter((job) => job.active !== false));
        setPMs(pmRes.data || []);
      } catch (err) {
        console.error("Dropdown load failed", err);
      } finally {
        setLoading(false);
      }
    };

    loadDropdowns();
  }, []);
  useEffect(() => {
    

    if (!draftLoadedRef.current) {
    const draft = {
      employee_name: employeeName,
      period_type: periodType,
      week_ending: weekEnding ? weekEnding.toISOString() : null,
      days,
      messages,
      nights_away: parseInt(nightsAway, 10) || 0,
      employee_signature: employeeSignature
    };

    draftRef.current = draft;
      draftLoadedRef.current = true;
    localStorage.setItem(getDraftKey(isEditing, id), JSON.stringify(draft));
    }
  }, [employeeName, periodType, weekEnding, days, messages, nightsAway, employeeSignature, isEditing, id]);
  // LOAD task codes + project managers
  

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
      <div className="fade-in" data-testid="timesheet-form">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" className="px-1 py-1 text-[11px]" onClick={() => { saveDraftNow(); navigate(-1); }} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-lg font-semibold text-gray-900" data-testid="form-title">
              {isEditing ? "Edit Timesheet" : "New Timesheet"}
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Top Form Fields */}
          <div className="card p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="employeeName">Employee Name</Label>
                <div className="mt-1 text-sm font-medium text-gray-800">
  {user?.name}
</div>
              </div>

              <div>
                <Label>Period Type</Label>
                <Select value={periodType} onValueChange={(value) => { setPeriodType(value); saveDraftNow({ period_type: value }); }}>
                  <SelectTrigger className="mt-0.5 text-[11px] py-1 px-1" data-testid="period-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="fortnightly">Fortnightly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Week Ending (Sunday)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline" className="px-1\.5 py-0\.5 text-[10px]"
                      className="w-full mt-1 justify-start text-left font-normal"
                      data-testid="week-ending-button"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {weekEnding ? format(weekEnding, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={weekEnding}
                      onSelect={(date) => {
                        if (date) {
                          const sunday = endOfWeek(date, { weekStartsOn: 1 });
                          setWeekEnding(sunday);
                          saveDraftNow({ week_ending: sunday });
                        }
                      }}
                      data-testid="week-ending-calendar"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <Label htmlFor="nightsAway">Nights Away</Label>
                <Input
                  id="nightsAway"
                  type="text"
                  min="0"
                  value={nightsAway}
                  onChange={(e) => { setNightsAway(e.target.value); saveDraftNow({ nights_away: e.target.value }); }}
                  className="mt-0.5 text-[11px] py-1 px-1"
                  data-testid="nights-away-input"
                />
              </div>
            </div>
          </div>

          {/* Timesheet Grid */}
          <div className="card mb-6 overflow-x-auto" data-testid="timesheet-grid">
            <table className="w-full text-[11px]">
              <thead>
  <tr className="bg-gray-100 border-b">
    <th className="p-1 text-left font-semibold">Day</th>
    <th className="p-1 text-left font-semibold">Type</th>
    <th className="p-1 text-left font-semibold">Start</th>
    <th className="p-1 text-left font-semibold">Lunch</th>
    <th className="p-1 text-left font-semibold">Finish</th>
    <th className="p-1 text-left font-semibold">Hours</th>
    <th className="p-1 text-left font-semibold">Job</th>
    <th className="p-1 text-left font-semibold">Task</th>
    <th className="p-1 text-left font-semibold">PM</th>
    <th className="p-1 text-left font-semibold">Description</th>
    <th className="p-1 text-left font-semibold">Actions</th>
  </tr>
</thead>
<tbody>
  {days.map((day, dayIndex) => (
    <>
      {day.entries.map((entry, entryIndex) => (
        <tr key={`${dayIndex}-${entryIndex}`} className="border-b hover:bg-gray-50">

          {entryIndex === 0 && (
            <td className="p-1 font-medium bg-gray-50" rowSpan={day.entries.length}>
              {day.day}
            </td>
          )}

          {/* TYPE */}
          <td className="p-1">
            <select
              value={entry.type || "work"}
              onChange={(e) => updateEntry(dayIndex, entryIndex, "type", e.target.value)}
              className="w-28 text-[11px] border rounded px-1 py-0.5"
            >
              <option value="work">Work</option>
              <option value="public_holiday">Public Holiday</option>
              <option value="annual_leave">Annual Leave</option>
              <option value="sick">Sick</option>
            </select>
          </td>

          {/* START */}
          <td className="p-1">
            <Input
              type="time"
              value={entry.start_time}
              onChange={(e) => updateEntry(dayIndex, entryIndex, "start_time", e.target.value)}
              className="w-20 text-[11px]"
            />
          </td>

                                                          {/* LUNCH */}
            <td className="p-1">
              <Select
                value={
                  entry.lunch_duration === "0" ? "0" :
                  entry.lunch_duration === "30" ? "30" :
                  entry.lunch_duration === "60" ? "60" :
                  ""
                }
                disabled={isLeaveType(entry.type)}
                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "lunch_duration", v)}
              >
                <SelectTrigger className="w-24 text-[11px] px-1 py-0.5">
                  <SelectValue placeholder="Lunch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No lunch</SelectItem>
                  <SelectItem value="30">30 mins</SelectItem>
                  <SelectItem value="60">1 hr</SelectItem>
                </SelectContent>
              </Select>
            </td>

            {/* FINISH */}
          <td className="p-1">
            <Input
              type="time"
              value={entry.finish_time}
              onChange={(e) => updateEntry(dayIndex, entryIndex, "finish_time", e.target.value)}
              className="w-20 text-[11px]"
            />
          </td>

          {/* HOURS */}
          <td className="p-1 text-center font-medium">
            {entry.total_hours.toFixed(2)}
          </td>

          {/* JOB */}
          <td className="p-1">
            <Select
              value={entry.job_number || ""}
              disabled={isLeaveType(entry.type)}
              onValueChange={(v) => updateEntry(dayIndex, entryIndex, "job_number", v)}
            >
              <SelectTrigger className="w-24 text-[11px] px-1 py-0.5">
                <SelectValue placeholder="Select Job" />
              </SelectTrigger>
              <SelectContent>
                {jobNumbers.map((job) => (
                  <SelectItem key={job.id} value={job.job_number}>
                    {job.job_number}{job.description ? ` - ${job.description}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </td>

                      {/* TASK */}
            <td className="p-1">
              <Select
                value={entry.task_code || ""}
                disabled={isLeaveType(entry.type)}
                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "task_code", v)}
              >
                <SelectTrigger className="w-24 text-[11px] px-1 py-0.5">
                  <SelectValue placeholder="Select Task" />
                </SelectTrigger>
                <SelectContent>
                  {taskCodes.map((tc) => (
                    <SelectItem key={tc.id} value={tc.code}>
                      {tc.code} - {tc.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </td>

            {/* PM */}
            <td className="p-1">
              <Select
                value={entry.project_manager_id || ""}
                disabled={isLeaveType(entry.type)}
                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "project_manager_id", v)}
              >
                <SelectTrigger className="w-24 text-[11px] px-1 py-0.5">
                  <SelectValue placeholder="Select PM" />
                </SelectTrigger>
                <SelectContent>
                  {projectManagers.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      {pm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </td>

            {/* NOTES */}
          <td className="p-1">
            <Input
              value={entry.description || entry.other || ""}
              onChange={(e) => updateEntry(dayIndex, entryIndex, "description", e.target.value)}
              className="w-32 text-[11px]"
            />
          </td>

                      {/* Actions */}
            <td className="p-1">
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => addEntry(dayIndex)}
                >
                  +
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeEntry(dayIndex, entryIndex)}
                >
                  Clear
                </Button>
              </div>
            </td>
          </tr>
      ))}
    </>
  ))}

    <tr className="bg-gray-50 border-t">
  <td colSpan="5" className="p-1 text-right font-medium">Work</td>
  <td className="p-1 font-medium">{getTypeTotalHours("work").toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
<tr className="bg-gray-50">
  <td colSpan="5" className="p-1 text-right font-medium">Public Holiday</td>
  <td className="p-1 font-medium">{getTypeTotalHours("public_holiday").toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
<tr className="bg-gray-50">
  <td colSpan="5" className="p-1 text-right font-medium">Annual Leave</td>
  <td className="p-1 font-medium">{getTypeTotalHours("annual_leave").toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
<tr className="bg-gray-50">
  <td colSpan="5" className="p-1 text-right font-medium">Sick</td>
  <td className="p-1 font-medium">{getTypeTotalHours("sick").toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
<tr className="bg-gray-900 text-white">
  <td colSpan="5" className="p-1 text-right font-bold">TOTAL HOURS</td>
  <td className="p-1 font-bold text-lg">{getTotalHours().toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
</tbody>
            </table>
          </div>

          {/* Messages */}
          <div className="card p-6 mb-6">
            <Label htmlFor="messages">Messages / Notes</Label>
            <Textarea
              id="messages"
              value={messages}
              onChange={(e) => { setMessages(e.target.value); saveDraftNow({ messages: e.target.value }); }}
              placeholder="Any additional notes or messages..."
              className="mt-2"
              rows={3}
              data-testid="messages-input"
            />
          </div>

          {/* Signature */}
          <div className="card p-6 mb-6">
            <SignaturePad
              ref={signatureRef}
              label="Employee Signature (Sign to submit)"
              onSignatureChange={setEmployeeSignature}
              initialSignature={employeeSignature}
            />
          </div>

          {isPmEditing && (
            <div className="card mb-6">
              <Label htmlFor="pm-edit-reason" className="mb-2 block">
                Reason for PM edit
              </Label>
              <Textarea
                id="pm-edit-reason"
                value={pmEditReason}
                onChange={(e) => setPmEditReason(e.target.value)}
                placeholder="Explain what was changed and why"
                data-testid="pm-edit-reason"
              />
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline" className="px-1\.5 py-0\.5 text-[10px]" onClick={() => { saveDraftNow(); navigate(-1); }} data-testid="cancel-button">
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-gray-900 hover:bg-gray-800"
              disabled={saving}
              data-testid="submit-button"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : isEditing ? "Update Timesheet" : "Submit Timesheet"}
            </Button>
          </div>
          </form>

        {/* New Task Code Modal */}
        {showNewCode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="new-code-modal">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Add New Task Code</h3>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="newCode">Code</Label>
                  <Input
                    id="newCode"
                    value={newCodeValue}
                    onChange={(e) => setNewCodeValue(e.target.value)}
                    placeholder="e.g., 120"
                    className="mt-0.5 text-[11px] py-1 px-1"
                    data-testid="new-code-input"
                  />
                </div>
                <div>
                  <Label htmlFor="newDesc">Description</Label>
                  <Input
                    id="newDesc"
                    value={newCodeDesc}
                    onChange={(e) => setNewCodeDesc(e.target.value)}
                    placeholder="e.g., Scaffolding"
                    className="mt-0.5 text-[11px] py-1 px-1"
                    data-testid="new-code-desc-input"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-1 mt-6">
                <Button variant="outline" className="px-1\.5 py-0\.5 text-[10px]" onClick={() => setShowNewCode(false)} data-testid="cancel-new-code">
                  Cancel
                </Button>
                <Button onClick={handleAddTaskCode} className="bg-gray-900 hover:bg-gray-800" data-testid="save-new-code">
                  Add Code
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
























































































































































