import React, { useState, useEffect, useRef, useCallback } from "react";
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
const TIMESHEET_SIGNATURE_BACKUP_SUFFIX = "_signature_backup_v1";
const REFERENCE_LIST_REFRESH_MS = 60000;
const TIME_ROUNDING_MINUTES = 15;
const MOBILE_TIME_DEFAULTS_KEY = "timesheet_mobile_time_defaults_v1";
const DEFAULT_MOBILE_TIME_DEFAULTS = Object.freeze({
  start_time: "07:30",
  finish_time: "16:30",
  lunch_duration: "30"
});

const getFreshStartSessionKey = (stamp) =>
  `${TIMESHEET_DRAFT_KEY}_fresh_start_consumed_${stamp || "default"}`;

const hasConsumedFreshStart = (stamp) => {
  try {
    return window.localStorage.getItem(getFreshStartSessionKey(stamp)) === "1";
  } catch (e) {
    return false;
  }
};

const markFreshStartConsumed = (stamp) => {
  try {
    window.localStorage.setItem(getFreshStartSessionKey(stamp), "1");
  } catch (e) {
    // Ignore storage failures; draft save still works through localStorage where available.
  }
};

const readMobileTimeDefaults = () => {
  try {
    const raw = window.localStorage.getItem(MOBILE_TIME_DEFAULTS_KEY);
    return raw ? { ...DEFAULT_MOBILE_TIME_DEFAULTS, ...JSON.parse(raw) } : DEFAULT_MOBILE_TIME_DEFAULTS;
  } catch (e) {
    return DEFAULT_MOBILE_TIME_DEFAULTS;
  }
};

const writeMobileTimeDefaults = (nextDefaults) => {
  try {
    window.localStorage.setItem(MOBILE_TIME_DEFAULTS_KEY, JSON.stringify(nextDefaults));
  } catch (e) {
    // Ignore storage failures; entry save still continues.
  }
};

const getDraftKey = (isEditing, id) =>
  isEditing && id ? `${TIMESHEET_DRAFT_KEY}_edit_${id}` : TIMESHEET_DRAFT_KEY;

const getSignatureDraftKey = (isEditing, id) =>
  `${getDraftKey(isEditing, id)}${TIMESHEET_SIGNATURE_BACKUP_SUFFIX}`;

const hasMeaningfulDraftData = (draft = {}) => {
  // TIMESHEET MEANINGFUL DRAFT ONLY V1
  // Keep this helper self-contained so edit-page runtime cannot fail on declaration order.
  const normaliseDraftEntryType = (type) => {
    const value = String(type || "work").trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (value.includes("public") && value.includes("holiday")) return "public_holiday";
    if ((value.includes("ann") || value.includes("annual")) && value.includes("leave")) return "annual_leave";
    if (value.includes("sick")) return "sick";
    if (value.includes("unpaid")) return "unpaid_day_off";
    return value;
  };

  const hasWeekEnding = !!draft.week_ending;
  const hasMessages = !!String(draft.messages || "").trim();
  const hasNightsAway = (parseInt(draft.nights_away, 10) || 0) > 0;
  const hasSignature = !!draft.employee_signature;
  const hasEntries = Array.isArray(draft.days) && draft.days.some((day) =>
    Array.isArray(day?.entries) && day.entries.some((entry) => {
      if (!entry) return false;
      return [
        entry.start_time,
        entry.finish_time,
        entry.job_number,
        entry.task_code,
        entry.project_manager_id,
        entry.description,
        entry.other
      ].some((value) => value !== null && value !== undefined && String(value).trim() !== "") ||
        (parseFloat(entry.total_hours) || 0) > 0 ||
        ["public_holiday", "annual_leave", "sick", "unpaid_day_off"].includes(normaliseDraftEntryType(entry.type));
    })
  );

  return hasWeekEnding || hasMessages || hasNightsAway || hasSignature || hasEntries;
};

const emptyEntry = (type = "work") => ({
  // TIMESHEET WEEKEND BLANK TYPE V1
  type,
  start_time: "",
  lunch_duration: "30",
  finish_time: "",
  total_hours: 0,
  job_number: "",
  task_code: "",
  project_manager_id: "",
  description: "",
  other: ""
});

const normaliseEntryType = (type) => {
  const value = String(type || "work").trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (value.includes("public") && value.includes("holiday")) return "public_holiday";
  if ((value.includes("ann") || value.includes("annual")) && value.includes("leave")) return "annual_leave";
  if (value.includes("sick")) return "sick";
  if (value.includes("unpaid")) return "unpaid_day_off";

  return value;
};

const initialDays = () => DAYS.map(day => ({ day, entries: [] }));

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
  (e.type && !["public_holiday","annual_leave","sick","unpaid_day_off"].includes(normaliseEntryType(e.type)))
    ? ((e.start_time && e.finish_time) ? parseFloat(e.total_hours || 0) : 0)
    : parseFloat(e.total_hours || 0),
            job_number: e.job_number || "",
            task_code: e.task_code || e.code || "",
            project_manager_id: e.project_manager_id || e.pm_id || e.pm || "",
            description: e.description || e.other || "",
            other: e.other || e.description || "",
          }))
        : []
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
  const suppressNextDraftSaveRef = useRef(false);
  const hasLoadedDraftRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskCodes, setTaskCodes] = useState([]);
  // TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
  const [taskCodesByJob, setTaskCodesByJob] = useState({});
  const [jobNumbers, setJobNumbers] = useState([]);
  const [projectManagers, setPMs] = useState([]);
  const [defaults, setDefaults] = useState(() => readMobileTimeDefaults());

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
    setExpandedMobileEntries({});
    localStorage.removeItem(getDraftKey(false));
  };
  const [pmEditReason, setPmEditReason] = useState("");
  const isPmEditing = isEditing && user?.role === "project_manager";
  const [collapsedMobileDays, setCollapsedMobileDays] = useState(() =>
    DAYS.reduce((collapsedDays, _, index) => {
      collapsedDays[index] = true;
      return collapsedDays;
    }, {})
  );
  const [expandedMobileEntries, setExpandedMobileEntries] = useState({});

  // Submit handler: runtime-stable weekly timesheet submission flow
  
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

  const isPaidLeaveType = (type) => {
    return ["public_holiday", "annual_leave", "sick"].includes(normaliseEntryType(type));
  };

  const isUnpaidDayOffType = (type) => {
    return normaliseEntryType(type) === "unpaid_day_off";
  };

  const isLeaveType = (type) => {
    return isPaidLeaveType(type) || isUnpaidDayOffType(type);
  };

  const getDefaultLeaveHours = (dayLabel) => {
    return dayLabel === "Friday" ? 8 : 9;
  };

  // TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
  const normaliseTaskCodeValue = (value) => String(value || "").trim().toUpperCase();

  // TIMESHEET / GLOBAL TASK CODES IN JOB FILTER V1
  // Job-specific FitoutOS/task mappings stay first, but payroll/general codes must remain available for every job.
  const GLOBAL_TASK_CODE_VALUES = new Set([
    "P&G",
    "P&GS",
    "P&GT",
    "ACCOM",
    "OTHER",
    "R/M",
    "SAFETY",
    "STAFF",
    "TOOLS",
    "TRAINING",
    "ADMIN",
    "YARD"
  ]);

  const getTaskCodeOptionValue = (option = {}) => {
    return normaliseTaskCodeValue(option.code || option.value || option.id || option.label || option.name);
  };

  const isGlobalTaskCodeOption = (option = {}) => {
    const codeValue = getTaskCodeOptionValue(option);
    const labelValue = normaliseTaskCodeValue(
      option.description || option.name || option.label || option.title
    );

    return GLOBAL_TASK_CODE_VALUES.has(codeValue) ||
      labelValue.includes("PRELIMS") ||
      labelValue.includes("P&G SITE") ||
      labelValue.includes("P&G TRAVEL") ||
      labelValue.includes("ACCOMMODATION") ||
      labelValue.includes("REPAIRS") ||
      labelValue.includes("SAFETY") ||
      labelValue.includes("STAFF") ||
      labelValue.includes("TOOLS") ||
      labelValue.includes("TRAINING") ||
      labelValue.includes("ADMIN");
  };

  const mergeTaskCodeOptions = (primaryOptions = [], globalOptions = []) => {
    const seen = new Set();

    return [...primaryOptions, ...globalOptions].filter((option) => {
      const key = getTaskCodeOptionValue(option);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const getTaskCodesForJob = (jobNumber) => {
    const cleanJobNumber = String(jobNumber || "").trim();
    if (!cleanJobNumber) return [];

    const mappedOptions =
      taskCodesByJob[cleanJobNumber] ||
      taskCodesByJob[cleanJobNumber.toUpperCase()] ||
      [];

    const globalOptions = Array.isArray(taskCodes)
      ? taskCodes.filter(isGlobalTaskCodeOption)
      : [];

    return Array.isArray(mappedOptions) && mappedOptions.length > 0
      ? mergeTaskCodeOptions(mappedOptions, globalOptions)
      : taskCodes;
  };

  const getTaskCodesForEntry = (entry) => getTaskCodesForJob(entry?.job_number);

  // TIMESHEET MANAGER / MOBILE DAY COLLAPSE V1
  // Mobile-only completion summary for collapsible day cards. Desktop table remains unchanged.
  const getMobileDaySummary = (day, dayIndex) => {
    const dayName = day?.day || DAYS[dayIndex] || "";
    const entries = Array.isArray(day?.entries) ? day.entries : [];
    const isWeekend = dayName === "Saturday" || dayName === "Sunday";
    const total = getDayTotal(dayIndex);

    const entryHasValue = (entry = {}) => {
      return [
        entry.type,
        entry.start_time,
        entry.finish_time,
        entry.job_number,
        entry.task_code,
        entry.project_manager_id,
        entry.description,
        entry.other
      ].some((value) => value !== null && value !== undefined && String(value).trim() !== "") ||
        (parseFloat(entry.total_hours) || 0) > 0;
    };

    const entryIsComplete = (entry = {}) => {
      const type = normaliseEntryType(entry.type || "");

      if (["unpaid_day_off", "annual_leave", "sick", "public_holiday"].includes(type)) {
        return true;
      }

      if (type !== "work") {
        return false;
      }

      return Boolean(
        entry.start_time &&
        entry.finish_time &&
        entry.job_number &&
        entry.task_code &&
        entry.project_manager_id &&
        (parseFloat(entry.total_hours) || 0) > 0
      );
    };

    const meaningfulEntries = entries.filter(entryHasValue);

    if (meaningfulEntries.length === 0) {
      return isWeekend
        ? {
            label: "Optional",
            detail: "No weekend entry",
            badgeClass: "bg-gray-100 text-gray-700 border-gray-200"
          }
        : {
            label: "Needs info",
            detail: "No weekday entry",
            badgeClass: "bg-amber-100 text-amber-900 border-amber-200"
          };
    }

    const hasIncomplete = meaningfulEntries.some((entry) => !entryIsComplete(entry));

    if (hasIncomplete) {
      return {
        label: "Needs info",
        detail: `${meaningfulEntries.length} entr${meaningfulEntries.length === 1 ? "y" : "ies"} / ${total.toFixed(2)} hrs`,
        badgeClass: "bg-amber-100 text-amber-900 border-amber-200"
      };
    }

    return {
      label: "Complete",
      detail: `${meaningfulEntries.length} entr${meaningfulEntries.length === 1 ? "y" : "ies"} / ${total.toFixed(2)} hrs`,
      badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-200"
    };
  };

  // TIMESHEET MANAGER / MOBILE COLLAPSED DAY WORK TYPE V1
  // Shows the entry type beside Complete / Needs info in collapsed mobile day summaries.
  const getMobileDayWorkTypeLabel = (day) => {
    const entries = Array.isArray(day?.entries) ? day.entries : [];

    const entryHasValue = (entry = {}) => {
      return [
        entry.type,
        entry.start_time,
        entry.finish_time,
        entry.job_number,
        entry.task_code,
        entry.project_manager_id,
        entry.description,
        entry.other
      ].some((value) => value !== null && value !== undefined && String(value).trim() !== "") ||
        (parseFloat(entry.total_hours) || 0) > 0;
    };

    const typeLabelMap = {
      work: "Work",
      unpaid_day_off: "No Work",
      public_holiday: "Public Holiday",
      annual_leave: "Annual Leave",
      sick: "Sick"
    };

    const labels = Array.from(
      new Set(
        entries
          .filter(entryHasValue)
          .map((entry) => normaliseEntryType(entry.type || "work"))
          .map((type) => typeLabelMap[type] || "Other")
      )
    );

    if (labels.length === 0) return "Not Set";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels.join(" + ");
    return "Mixed";
  };

  // TIMESHEET MANAGER / MOBILE COMPACT DAY ROW V1
  // Keeps the closed row useful without repeating the full day-card content.
  const getMobileDayLineDetail = (day) => {
    const entries = Array.isArray(day?.entries) ? day.entries : [];
    const meaningfulEntries = entries.filter((entry = {}) => {
      return [
        entry.type,
        entry.start_time,
        entry.finish_time,
        entry.job_number,
        entry.task_code,
        entry.project_manager_id,
        entry.description,
        entry.other
      ].some((value) => value !== null && value !== undefined && String(value).trim() !== "") ||
        (parseFloat(entry.total_hours) || 0) > 0;
    });

    if (meaningfulEntries.length === 0) {
      return day?.day === "Saturday" || day?.day === "Sunday" ? "Optional" : "No entry";
    }

    const workEntries = meaningfulEntries.filter(
      (entry) => normaliseEntryType(entry.type || "work") === "work"
    );

    if (workEntries.length === 0) {
      return getMobileDayWorkTypeLabel(day);
    }

    const jobNumbersForDay = Array.from(
      new Set(workEntries.map((entry) => String(entry.job_number || "").trim()).filter(Boolean))
    );
    const taskLabel = `${workEntries.length} task${workEntries.length === 1 ? "" : "s"}`;

    if (jobNumbersForDay.length === 1) {
      return `${jobNumbersForDay[0]} · ${taskLabel}`;
    }

    if (jobNumbersForDay.length > 1) {
      return `${jobNumbersForDay.length} jobs · ${taskLabel}`;
    }

    return taskLabel;
  };

  const getMobileEntryLineDetail = (entry = {}) => {
    const type = normaliseEntryType(entry.type || "work");
    const typeLabels = {
      unpaid_day_off: "No Work",
      public_holiday: "Public Holiday",
      annual_leave: "Annual Leave",
      sick: "Sick"
    };

    if (type !== "work") {
      return typeLabels[type] || "Other";
    }

    const jobNumber = String(entry.job_number || "").trim();
    const taskCode = String(entry.task_code || "").trim();
    const taskOption = getTaskCodesForEntry(entry).find(
      (option) => normaliseTaskCodeValue(option.code || option.value) === normaliseTaskCodeValue(taskCode)
    );
    const taskDescription = String(taskOption?.description || taskOption?.name || "").trim();
    const taskText = [taskCode, taskDescription].filter(Boolean).join(" – ");

    if (jobNumber && taskText) return `${jobNumber} · ${taskText}`;
    if (jobNumber) return `${jobNumber} · Select task`;
    if (taskText) return taskText;
    return "Work · Needs info";
  };

  const toggleMobileDayCollapsed = (dayIndex) => {
    setCollapsedMobileDays((current) => ({
      ...current,
      [dayIndex]: !current[dayIndex]
    }));
  };
const updateEntry = (dayIndex, entryIndex, field, value) => {
  setDays(prev => {
    const copy = [...prev];
    const currentDay = copy[dayIndex];
    if (!currentDay || !currentDay.entries[entryIndex]) return prev;

    const entry = { ...currentDay.entries[entryIndex] };
    const dayLabel = currentDay.day || "";

    entry[field] = field === "type" ? normaliseEntryType(value) : value;

    // TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
    if (field === "job_number" && !isLeaveType(entry.type)) {
      const nextTaskOptions = getTaskCodesForJob(value);
      const currentTaskCode = normaliseTaskCodeValue(entry.task_code);
      const isCurrentTaskValid =
        !currentTaskCode ||
        !nextTaskOptions.length ||
        nextTaskOptions.some((tc) => normaliseTaskCodeValue(tc.code || tc.value) === currentTaskCode);

      if (!isCurrentTaskValid) {
        entry.task_code = "";
      }
    }
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
      if (isPaidLeaveType(value)) {
        entry.start_time = "";
        entry.lunch_duration = "";
        entry.finish_time = "";
        entry.job_number = "";
        entry.task_code = "";
        entry.project_manager_id = "";
        entry.total_hours = getDefaultLeaveHours(dayLabel);
      } else if (isUnpaidDayOffType(value)) {
        entry.start_time = "";
        entry.lunch_duration = "";
        entry.finish_time = "";
        entry.job_number = "";
        entry.task_code = "";
        entry.project_manager_id = "";
        entry.total_hours = 0;
        entry.description = entry.description || "No Work";
        entry.other = entry.other || "No Work";
      } else {
        entry.total_hours = 0;
      }
    }

    if (!isLeaveType(entry.type)) {
      const hasStart = isClockTimeValue(entry.start_time);
      const hasFinish = isClockTimeValue(entry.finish_time);

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

      const currentEntries = Array.isArray(currentDay.entries) ? currentDay.entries : [];
      const lastEntry = currentEntries[currentEntries.length - 1];
      const hasBlankLastEntry = !!lastEntry &&
        !isLeaveType(lastEntry.type) &&
        !lastEntry.start_time &&
        !lastEntry.finish_time &&
        !lastEntry.job_number &&
        !lastEntry.task_code &&
        !lastEntry.project_manager_id &&
        !lastEntry.description &&
        !lastEntry.other &&
        (parseFloat(lastEntry.total_hours) || 0) <= 0;

      if (hasBlankLastEntry) {
        return prev;
      }

      const updated = prev.map((day, idx) =>
        idx === dayIndex
          ? { ...day, entries: [...currentEntries, emptyEntry(["Saturday", "Sunday"].includes(currentDay.day) ? "" : "work")] }
          : day
      );

      saveDraftNow({ days: updated });
      return updated;
    });
  };

  // TIMESHEET MANAGER / MOBILE SINGLE OPEN TASK V1
  // Only one task editor is open per day. Adding a task collapses the current
  // editor and opens the newly-created row (or the existing blank last row).
  const isBlankTimesheetEntry = (entry) => {
    return !!entry &&
      !isLeaveType(entry.type) &&
      !entry.start_time &&
      !entry.finish_time &&
      !entry.job_number &&
      !entry.task_code &&
      !entry.project_manager_id &&
      !entry.description &&
      !entry.other &&
      (parseFloat(entry.total_hours) || 0) <= 0;
  };

  const addMobileEntry = (dayIndex) => {
    const entries = Array.isArray(days[dayIndex]?.entries) ? days[dayIndex].entries : [];
    const lastEntryIndex = entries.length - 1;
    const targetEntryIndex = lastEntryIndex >= 0 && isBlankTimesheetEntry(entries[lastEntryIndex])
      ? lastEntryIndex
      : entries.length;

    addEntry(dayIndex);
    setCollapsedMobileDays((current) => ({ ...current, [dayIndex]: false }));
    setExpandedMobileEntries((current) => ({ ...current, [dayIndex]: targetEntryIndex }));
  };

  const toggleMobileEntry = (dayIndex, entryIndex) => {
    setExpandedMobileEntries((current) => ({
      ...current,
      [dayIndex]: current[dayIndex] === entryIndex ? null : entryIndex
    }));
  };

  const removeMobileEntry = (dayIndex, entryIndex) => {
    removeEntry(dayIndex, entryIndex);
    setExpandedMobileEntries((current) => {
      const currentEntryIndex = current[dayIndex];
      let nextEntryIndex = currentEntryIndex;

      if (currentEntryIndex === entryIndex) nextEntryIndex = null;
      if (typeof currentEntryIndex === "number" && currentEntryIndex > entryIndex) {
        nextEntryIndex = currentEntryIndex - 1;
      }

      return { ...current, [dayIndex]: nextEntryIndex };
    });
  };

  const clearMobileDay = (dayIndex) => {
    clearDay(dayIndex);
    setExpandedMobileEntries((current) => ({ ...current, [dayIndex]: null }));
  };
  const removeEntry = (dayIndex, entryIndex) => {
    setDays(prev => {
      const currentDay = prev[dayIndex];
      if (!currentDay) return prev;

      const currentEntries = Array.isArray(currentDay.entries) ? currentDay.entries : [];
      const nextEntries = currentEntries.filter((_, idx) => idx !== entryIndex);

      const updated = prev.map((day, idx) =>
        idx === dayIndex
          ? { ...day, entries: nextEntries }
          : day
      );

      saveDraftNow({ days: updated });
      return updated;
    });
  };

  const clearDay = (dayIndex) => {
    setDays(prev => {
      const currentDay = prev[dayIndex];
      if (!currentDay) return prev;

      const updated = prev.map((day, idx) =>
        idx === dayIndex
          ? { ...day, entries: [] }
          : day
      );

      saveDraftNow({ days: updated });
      return updated;
    });
  };

  const startEntryNow = (dayIndex, entryIndex) => {
    setEntryRoundedNow(dayIndex, entryIndex, "start_time");
  };

  const finishEntryNow = (dayIndex, entryIndex) => {
    setEntryRoundedNow(dayIndex, entryIndex, "finish_time");
  };

  const formatMinutesAsTime = (totalMinutes) => {
    const minutesInDay = 24 * 60;
    const normalised = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
    const hours = Math.floor(normalised / 60);
    const minutes = normalised % 60;
    return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
  };

  const isClockTimeValue = (value) => {
    return /^\d{2}:\d{2}$/.test(String(value || ""));
  };

  const parseManualTimeToMinutes = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;

    const isPm = raw.includes("p");
    const isAm = raw.includes("a");
    const cleaned = raw.replace(/[^0-9:.]/g, "").replace(".", ":");

    let hours;
    let minutes;

    if (cleaned.includes(":")) {
      const parts = cleaned.split(":");
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1] || "0", 10);
    } else {
      const digits = cleaned.replace(/\D/g, "");
      if (!digits) return null;

      if (digits.length <= 2) {
        hours = parseInt(digits, 10);
        minutes = 0;
      } else {
        hours = parseInt(digits.slice(0, -2), 10);
        minutes = parseInt(digits.slice(-2), 10);
      }
    }

    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) return null;

    if (isPm && hours < 12) hours += 12;
    if (isAm && hours === 12) hours = 0;
    if (hours < 0 || hours > 23) return null;

    return (hours * 60) + minutes;
  };

  const formatTimeFor12HourDisplay = (value) => {
    const minutes = parseManualTimeToMinutes(value);
    if (minutes === null) return "";

    const normalised = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hours24 = Math.floor(normalised / 60);
    const mins = normalised % 60;
    const suffix = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;

    return String(hours12) + ":" + String(mins).padStart(2, "0") + " " + suffix;
  };

  const formatTimeForMobileInput = (value) => {
    const rawValue = String(value || "");
    if (!rawValue) return "";
    if (!isClockTimeValue(rawValue)) return rawValue;
    return formatTimeFor12HourDisplay(rawValue);
  };

  const getMobileDefaultTimeLabel = (field) => {
    return formatTimeFor12HourDisplay(defaults?.[field] || DEFAULT_MOBILE_TIME_DEFAULTS[field] || "");
  };

  const roundMinutesToStep = (minutes) => {
    return Math.round(minutes / TIME_ROUNDING_MINUTES) * TIME_ROUNDING_MINUTES;
  };

  const getCurrentTimeString = () => {
    const now = new Date();
    const minutes = (now.getHours() * 60) + now.getMinutes();
    return formatMinutesAsTime(roundMinutesToStep(minutes));
  };

  const hasManualMeridiem = (value) => /[ap]/i.test(String(value || ""));

  const inferManualTimeMinutes = (value, field = "start_time", entry = null) => {
    let minutes = parseManualTimeToMinutes(value);
    if (minutes === null) return null;

    if (!hasManualMeridiem(value) && field === "finish_time" && entry?.start_time) {
      const startMinutes = parseManualTimeToMinutes(entry.start_time);
      if (startMinutes !== null && minutes <= startMinutes && minutes + (12 * 60) < (24 * 60)) {
        minutes += 12 * 60;
      }
    }

    return minutes;
  };

  const saveMobileTimeDefaults = (patch) => {
    const nextDefaults = { ...DEFAULT_MOBILE_TIME_DEFAULTS, ...(defaults || {}), ...patch };
    setDefaults(nextDefaults);
    writeMobileTimeDefaults(nextDefaults);
    return nextDefaults;
  };

  const normaliseManualTimeInput = (value, field = "start_time", entry = null) => {
    const minutes = inferManualTimeMinutes(value, field, entry);
    if (minutes === null) return "";
    return formatMinutesAsTime(roundMinutesToStep(minutes));
  };

  const applyManualEntryTime = (dayIndex, entryIndex, field, value) => {
    const entry = days[dayIndex]?.entries?.[entryIndex] || null;
    const nextValue = normaliseManualTimeInput(value, field, entry);
    updateEntry(dayIndex, entryIndex, field, nextValue);
    if (nextValue) saveMobileTimeDefaults({ [field]: nextValue });
  };

  const handleManualTimeKeyDown = (event, dayIndex, entryIndex, field) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    applyManualEntryTime(dayIndex, entryIndex, field, event.currentTarget.value);
    event.currentTarget.blur();
  };

  const setEntryDefaultTime = (dayIndex, entryIndex, field) => {
    const nextValue = defaults?.[field] || DEFAULT_MOBILE_TIME_DEFAULTS[field] || getCurrentTimeString();
    updateEntry(dayIndex, entryIndex, field, nextValue);
    saveMobileTimeDefaults({ [field]: nextValue });
  };

  const setEntryRoundedNow = (dayIndex, entryIndex, field) => {
    const nextValue = getCurrentTimeString();
    updateEntry(dayIndex, entryIndex, field, nextValue);
    saveMobileTimeDefaults({ [field]: nextValue });
  };

  const adjustEntryTime = (dayIndex, entryIndex, field, deltaMinutes) => {
    const current = days[dayIndex]?.entries?.[entryIndex]?.[field];
    const currentMinutes = parseManualTimeToMinutes(current);
    const fallbackMinutes = parseManualTimeToMinutes(defaults?.[field] || DEFAULT_MOBILE_TIME_DEFAULTS[field] || getCurrentTimeString()) || 0;
    const nextMinutes = (currentMinutes === null ? fallbackMinutes : currentMinutes) + deltaMinutes;
    const nextValue = formatMinutesAsTime(nextMinutes);
    updateEntry(dayIndex, entryIndex, field, nextValue);
    saveMobileTimeDefaults({ [field]: nextValue });
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

    const saveDraftNow = useCallback((override = {}) => {
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

      const signatureForBackup = nextDraft.employee_signature || null;
      const draftForStorage = { ...nextDraft, employee_signature: null };

      try {
        if (signatureForBackup) {
          localStorage.setItem(getSignatureDraftKey(isEditing, id), signatureForBackup);
        } else {
          localStorage.removeItem(getSignatureDraftKey(isEditing, id));
        }
      } catch (signatureError) {
        console.error("Signature backup save failed", signatureError);
      }

      draftRef.current = nextDraft;

      if (!isEditing && !hasMeaningfulDraftData(nextDraft)) {
        localStorage.removeItem(getDraftKey(isEditing, id));
        localStorage.removeItem(getSignatureDraftKey(isEditing, id));
        return;
      }

      localStorage.setItem(getDraftKey(isEditing, id), JSON.stringify(draftForStorage));
    } catch (e) {
      console.error("Draft save failed", e);
    }
  }, [employeeName, periodType, weekEnding, days, messages, nightsAway, employeeSignature, isEditing, id]);

  const handleEmployeeSignatureChange = (signatureData) => {
    setEmployeeSignature(signatureData);
    saveDraftNow({ employee_signature: signatureData });
  };

  const persistCurrentSignatureDraft = useCallback(() => {
    try {
      const signatureData = signatureRef.current?.getSignature?.() || employeeSignature || null;
      saveDraftNow({ employee_signature: signatureData });
      return signatureData;
    } catch (e) {
      console.error("Signature draft persistence failed", e);
      return null;
    }
  }, [employeeSignature, saveDraftNow]);

  useEffect(() => {
    if (!isFreshStart) return;
    if (hasConsumedFreshStart(freshStartStamp)) return;

    markFreshStartConsumed(freshStartStamp);

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

  if (isFreshStart && !hasConsumedFreshStart(freshStartStamp)) {
    markFreshStartConsumed(freshStartStamp);
    localStorage.removeItem(draftKey);
    draftRef.current = null;
    draftLoadedRef.current = true;
    hasLoadedDraftRef.current = true;
    return;
  }

  try {
    // TIMESHEET EDIT LOAD SERVER FIRST V1
    // Edit mode must load the real server timesheet first. A stale local edit draft can make Fix / Resubmit open blank.
    if (isEditing && id) {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(getSignatureDraftKey(isEditing, id));
    } else {
    const raw = localStorage.getItem(draftKey);
    const signatureBackup = localStorage.getItem(getSignatureDraftKey(isEditing, id));

    if (raw) {
      const draft = JSON.parse(raw);
      if (!hasMeaningfulDraftData({ ...draft, employee_signature: draft.employee_signature || signatureBackup || null })) {
        localStorage.removeItem(draftKey);
        localStorage.removeItem(getSignatureDraftKey(isEditing, id));
        draftLoadedRef.current = true;
        return;
      }
      suppressNextDraftSaveRef.current = true;

      setEmployeeName(draft.employee_name || "");
      setPeriodType(draft.period_type || "weekly");
      setWeekEnding(draft.week_ending ? new Date(draft.week_ending) : null);
      setDays(normalizeDays(draft.days));
      setMessages(draft.messages || "");
      setNightsAway(draft.nights_away || 0);
      setEmployeeSignature(draft.employee_signature || signatureBackup || null);

      draftLoadedRef.current = true;
      return;
    }
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
      suppressNextDraftSaveRef.current = true;

      setEmployeeName(ts.employee_name || user?.name || "");
      setPeriodType(ts.period_type || "weekly");
      setWeekEnding(ts.week_ending ? new Date(ts.week_ending) : null);
      // TIMESHEET REJECTED EMPLOYEE EDIT GUARD V1
      if (user?.role === "employee" && ts.status && ts.status !== "rejected") {
        toast.error("Submitted and approved timesheets are read-only. Ask an admin or PM to reject/return it if changes are needed.");
        navigate(`/timesheet/${id}`);
        return;
      }

      const serverDays = normalizeDays(ts.days);
      setDays(serverDays);
      setMessages(ts.messages || "");
      setNightsAway(ts.nights_away || 0);
      setEmployeeSignature(ts.employee_signature || null);
      setPmEditReason("");

      draftRef.current = {
        employee_name: ts.employee_name || user?.name || "",
        period_type: ts.period_type || "weekly",
        week_ending: ts.week_ending || null,
        days: serverDays,
        messages: ts.messages || "",
        nights_away: ts.nights_away || 0,
        employee_signature: ts.employee_signature || null
      };

    } catch (err) {
      // TIMESHEET EDIT LOAD ERROR VISIBILITY V1
      console.error("Timesheet edit load failed", err);
      toast.error(formatApiError(err, "Could not load this timesheet for editing"));
      navigate(`/timesheet/${id}`);
    } finally {
      setLoading(false);
      draftLoadedRef.current = true;
    }
  };

  loadTimesheet();

}, [isEditing, id, user, isFreshStart, freshStartStamp, navigate]);

const handleSubmit = async (e) => {
  e.preventDefault();

  try {
    setSaving(true);

    const cleanedDays = days
      .map((day) => ({
        ...day,
        entries: (day.entries || []).filter((entry) => {
          const type = normaliseEntryType(entry.type || "work");
          if (isUnpaidDayOffType(type)) {
            return true;
          }
          if (isPaidLeaveType(type)) {
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
      .find(({ entry }) => isPaidLeaveType(entry.type || "work") && (parseFloat(entry.total_hours) || 0) <= 0);

    if (leaveEntryMissingHours) {
      toast.error(`Leave hours are required on ${leaveEntryMissingHours.day}`);
      return;
    }

    const incompleteWorkEntry = days
      .flatMap((day) => (day.entries || []).map((entry) => ({ day: day.day, entry })))
      .find(({ entry }) => {
        if (isLeaveType(normaliseEntryType(entry.type || "work"))) return false;

        const workStartedFields = requiredWorkFields.filter(([field]) => field !== "lunch_duration");
        const rowHasAnyValue =
          workStartedFields.some(([field]) => hasEntryValue(entry[field])) ||
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

    // TIMESHEET MANAGER / WEEKDAY COMPLETENESS SUBMIT GUARD V4
    // Payroll rule: Monday-Friday must be deliberately confirmed before staff submit.
    // Weekends remain optional unless the staff member adds weekend work.
    if (!isPmEditing) {
      const requiredWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      const confirmedWeekdayTypes = new Set([
        "work",
        "no_work",
        "unpaid_day_off",
        "annual_leave",
        "sick",
        "public_holiday"
      ]);
      const normaliseWeekdayTypeForSubmit = (value) =>
        String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");

      const missingRequiredWeekday = requiredWeekdays.find((weekday) => {
        const day = days.find((item) => item.day === weekday);
        const entries = Array.isArray(day?.entries) ? day.entries : [];

        return !entries.some((entry) =>
          confirmedWeekdayTypes.has(normaliseWeekdayTypeForSubmit(entry?.type))
        );
      });

      if (missingRequiredWeekday) {
        toast.error(`${missingRequiredWeekday} must be completed before submitting. Select Work, No Work, Annual Leave, Sick, or Public Holiday.`);
        return;
      }
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
      toast.success("Timesheet updated and returned for approval");
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
    let isMounted = true;

    const loadDropdowns = async ({ showSpinner = false } = {}) => {
      try {
        if (showSpinner) {
          setLoading(true);
        }

        const [codesRes, pmRes, jobsRes, referenceRes] = await Promise.all([
          axios.get(`${API}/task-codes`),
          axios.get(`${API}/project-managers`),
          axios.get(`${API}/job-numbers`),
          axios.get(`${API}/timesheets/reference-options`, { withCredentials: true }).catch((err) => {
            console.warn("Reference options mapping refresh failed", err);
            return { data: {} };
          })
        ]);

        if (!isMounted) return;

        const referenceData = referenceRes.data || {};
        setTaskCodes(codesRes.data || referenceData.task_codes || []);
        // TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
        setTaskCodesByJob(referenceData.task_codes_by_job || {});
        setJobNumbers((jobsRes.data || []).filter((job) => job.active !== false));
        setPMs(pmRes.data || []);
      } catch (err) {
        console.error("Reference list refresh failed", err);
      } finally {
        if (showSpinner && isMounted) {
          setLoading(false);
        }
      }
    };

    const refreshReferenceLists = () => loadDropdowns({ showSpinner: false });

    const handleReferenceListFocus = () => {
      refreshReferenceLists();
    };

    const handleReferenceListVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshReferenceLists();
      }
    };

    loadDropdowns({ showSpinner: true });

    const referenceListInterval = window.setInterval(refreshReferenceLists, REFERENCE_LIST_REFRESH_MS);
    window.addEventListener("focus", handleReferenceListFocus);
    document.addEventListener("visibilitychange", handleReferenceListVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(referenceListInterval);
      window.removeEventListener("focus", handleReferenceListFocus);
      document.removeEventListener("visibilitychange", handleReferenceListVisibilityChange);
    };
  }, []);
  useEffect(() => {
    const handleSignaturePageHide = () => {
      persistCurrentSignatureDraft();
    };

    const handleSignatureVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistCurrentSignatureDraft();
      }
    };

    window.addEventListener("pagehide", handleSignaturePageHide);
    window.addEventListener("beforeunload", handleSignaturePageHide);
    document.addEventListener("visibilitychange", handleSignatureVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handleSignaturePageHide);
      window.removeEventListener("beforeunload", handleSignaturePageHide);
      document.removeEventListener("visibilitychange", handleSignatureVisibilityChange);
    };
  }, [persistCurrentSignatureDraft]);

  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (suppressNextDraftSaveRef.current) {
      suppressNextDraftSaveRef.current = false;
      return;
    }

    saveDraftNow();
  }, [saveDraftNow]);
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
      <div className="fade-in w-full max-w-full overflow-x-hidden" data-testid="timesheet-form">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" className="mr-4 px-2 py-2 text-[12px]" onClick={() => { saveDraftNow(); navigate(-1); }} data-testid="back-button">
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
                      variant="outline"
                      className="w-full mt-1 justify-start text-left font-normal px-2 py-2 text-[12px]"
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

          {/* Mobile Timesheet Day Cards */}
          <div className="lg:hidden w-full max-w-full min-w-0 overflow-x-hidden space-y-2 mb-6" data-testid="timesheet-mobile-grid">
            {days.map((day, dayIndex) => {
              const daySummary = getMobileDaySummary(day, dayIndex);
              const dayLineDetail = getMobileDayLineDetail(day);
              const isMobileDayCollapsed = !!collapsedMobileDays[dayIndex];
              const hasDayEntries = Array.isArray(day.entries) && day.entries.length > 0;

              return (
                <div
                  key={day.day || dayIndex}
                  className={"card mobile-day-compact-card w-full max-w-full min-w-0 overflow-hidden " + (isMobileDayCollapsed ? "is-collapsed" : "is-expanded")}
                  data-testid={"mobile-day-card-" + dayIndex}
                >
                  <button
                    type="button"
                    className="mobile-day-summary-row"
                    onClick={() => {
                      if (isMobileDayCollapsed && !hasDayEntries) {
                        addMobileEntry(dayIndex);
                        return;
                      }
                      toggleMobileDayCollapsed(dayIndex);
                    }}
                    aria-expanded={!isMobileDayCollapsed}
                    aria-label={`${day.day}: ${dayLineDetail}. ${daySummary.label}. ${hasDayEntries ? `${getDayTotal(dayIndex).toFixed(2)} hours` : "Add entry"}`}
                    data-testid={"mobile-toggle-day-" + dayIndex}
                  >
                    <span className="mobile-day-summary-name">{day.day}</span>
                    <span className="mobile-day-summary-detail">{dayLineDetail}</span>
                    <span
                      className={"mobile-day-summary-status " + daySummary.badgeClass}
                      title={daySummary.label}
                      aria-hidden="true"
                    />
                    <span className={"mobile-day-summary-total " + (!hasDayEntries ? "is-add" : "")}>
                      {hasDayEntries ? `${getDayTotal(dayIndex).toFixed(2)}h` : "+ Add"}
                    </span>
                    <span className="mobile-day-summary-chevron" aria-hidden="true">
                      {isMobileDayCollapsed ? "›" : "⌃"}
                    </span>
                  </button>

                  {!isMobileDayCollapsed && (
                    <div className="mobile-day-expanded" data-testid={"mobile-day-expanded-" + dayIndex}>
                      <div className="mobile-day-actions grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full px-2 py-2 text-[12px] font-semibold"
                          onClick={() => addMobileEntry(dayIndex)}
                          data-testid={"mobile-add-entry-" + dayIndex}
                        >
                          Add Task Entry
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full px-2 py-2 text-[12px] font-semibold text-red-700"
                          onClick={() => clearMobileDay(dayIndex)}
                          disabled={!day.entries || day.entries.length === 0}
                          data-testid={"mobile-clear-day-" + dayIndex}
                        >
                          Clear Day
                        </Button>
                      </div>

                      <div className="mobile-entry-list mt-3 space-y-2">
                      {(!day.entries || day.entries.length === 0) && (
                        <div
                          className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-center text-sm font-semibold text-gray-600"
                          data-testid={"mobile-empty-day-" + dayIndex}
                        >
                          No entry yet. Tap Add Task Entry to start.
                        </div>
                      )}

                      {(day.entries || []).map((entry, entryIndex) => (
                        <div
                          key={dayIndex + "-" + entryIndex}
                          className={
                            "mobile-entry-card mobile-entry-card-" +
                            ((entryIndex % 4) + 1) +
                            " w-full max-w-full min-w-0 overflow-hidden rounded-lg border p-0 shadow-sm " +
                            (expandedMobileEntries[dayIndex] === entryIndex ? "is-expanded" : "is-collapsed")
                          }
                          data-testid={"mobile-entry-" + dayIndex + "-" + entryIndex}
                        >
                          <button
                            type="button"
                            className="mobile-entry-summary-row"
                            onClick={() => toggleMobileEntry(dayIndex, entryIndex)}
                            aria-expanded={expandedMobileEntries[dayIndex] === entryIndex}
                            aria-label={`Task ${entryIndex + 1}: ${getMobileEntryLineDetail(entry)}. ${(parseFloat(entry.total_hours) || 0).toFixed(2)} hours`}
                            data-testid={"mobile-toggle-entry-" + dayIndex + "-" + entryIndex}
                          >
                            <span className="mobile-entry-summary-name">Task {entryIndex + 1}</span>
                            <span className="mobile-entry-summary-detail">{getMobileEntryLineDetail(entry)}</span>
                            <span className="mobile-entry-summary-total">{(parseFloat(entry.total_hours) || 0).toFixed(2)}h</span>
                            <span className="mobile-entry-summary-chevron" aria-hidden="true">
                              {expandedMobileEntries[dayIndex] === entryIndex ? "⌃" : "›"}
                            </span>
                          </button>

                          {expandedMobileEntries[dayIndex] === entryIndex && (
                            <div className="mobile-entry-editor" data-testid={"mobile-entry-editor-" + dayIndex + "-" + entryIndex}>
                              <div className="grid grid-cols-1 gap-3">
                            <div>
                              <Label className="text-[11px]">Type</Label>
                              <select
                                value={entry.type || ""}
                                onChange={(e) => updateEntry(dayIndex, entryIndex, "type", e.target.value)}
                                className="mobile-entry-field mt-1 h-12 w-full rounded-md px-3 text-base font-bold"
                                data-testid={"mobile-type-" + dayIndex + "-" + entryIndex}
                              >
                                <option value="" disabled>Select type</option>
                                <option value="work">Work</option>
                                <option value="unpaid_day_off">No Work</option>
                                <option value="public_holiday">Public Holiday</option>
                                <option value="annual_leave">Annual Leave</option>
                                <option value="sick">Sick</option>
                              </select>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <Label className="text-[11px]">Start</Label>
                                <Input
                                  type="text"
                                  inputMode="text"
                                  placeholder={getMobileDefaultTimeLabel("start_time")}
                                  value={formatTimeForMobileInput(entry.start_time)}
                                  disabled={isLeaveType(entry.type)}
                                  onFocus={(e) => {
                                    e.currentTarget.select();
                                  }}
                                  onClick={(e) => {
                                    e.currentTarget.select();
                                  }}
                                  onChange={(e) => updateEntry(dayIndex, entryIndex, "start_time", e.target.value)}
                                  onBlur={(e) => applyManualEntryTime(dayIndex, entryIndex, "start_time", e.target.value)}
                                  onKeyDown={(e) => handleManualTimeKeyDown(e, dayIndex, entryIndex, "start_time")}
                                  className="mobile-entry-field mobile-time-entry-input mt-1 h-12 text-base font-bold"
                                  data-testid={"mobile-start-" + dayIndex + "-" + entryIndex}
                                />
                                <div className="mobile-time-button-row mt-1 grid grid-cols-2 gap-1">
                                  <Button type="button" variant="outline" className="px-1 py-1 text-[10px]" disabled={isLeaveType(entry.type)} onClick={() => setEntryDefaultTime(dayIndex, entryIndex, "start_time")} data-testid={"mobile-start-use-default-" + dayIndex + "-" + entryIndex}>Use {getMobileDefaultTimeLabel("start_time")}</Button>
                                  <Button type="button" variant="outline" className="px-1 py-1 text-[10px]" disabled={isLeaveType(entry.type)} onClick={() => setEntryRoundedNow(dayIndex, entryIndex, "start_time")} data-testid={"mobile-start-now-round-" + dayIndex + "-" + entryIndex}>Now</Button>
                                </div>
                              </div>

                              <div>
                                <Label className="text-[11px]">Finish</Label>
                                <Input
                                  type="text"
                                  inputMode="text"
                                  placeholder={getMobileDefaultTimeLabel("finish_time")}
                                  value={formatTimeForMobileInput(entry.finish_time)}
                                  disabled={isLeaveType(entry.type)}
                                  onFocus={(e) => {
                                    e.currentTarget.select();
                                  }}
                                  onClick={(e) => {
                                    e.currentTarget.select();
                                  }}
                                  onChange={(e) => updateEntry(dayIndex, entryIndex, "finish_time", e.target.value)}
                                  onBlur={(e) => applyManualEntryTime(dayIndex, entryIndex, "finish_time", e.target.value)}
                                  onKeyDown={(e) => handleManualTimeKeyDown(e, dayIndex, entryIndex, "finish_time")}
                                  className="mobile-entry-field mobile-time-entry-input mt-1 h-12 text-base font-bold"
                                  data-testid={"mobile-finish-" + dayIndex + "-" + entryIndex}
                                />
                                <div className="mobile-time-button-row mt-1 grid grid-cols-2 gap-1">
                                  <Button type="button" variant="outline" className="px-1 py-1 text-[10px]" disabled={isLeaveType(entry.type)} onClick={() => setEntryDefaultTime(dayIndex, entryIndex, "finish_time")} data-testid={"mobile-finish-use-default-" + dayIndex + "-" + entryIndex}>Use {getMobileDefaultTimeLabel("finish_time")}</Button>
                                  <Button type="button" variant="outline" className="px-1 py-1 text-[10px]" disabled={isLeaveType(entry.type)} onClick={() => setEntryRoundedNow(dayIndex, entryIndex, "finish_time")} data-testid={"mobile-finish-now-round-" + dayIndex + "-" + entryIndex}>Now</Button>
                                </div>
                              </div>
                            </div>

                            <div>
                              <Label className="text-[11px]">Lunch</Label>
                              <Select
                                value={entry.lunch_duration || defaults?.lunch_duration || DEFAULT_MOBILE_TIME_DEFAULTS.lunch_duration}
                                disabled={isLeaveType(entry.type)}
                                onValueChange={(v) => {
                                  updateEntry(dayIndex, entryIndex, "lunch_duration", v);
                                  saveMobileTimeDefaults({ lunch_duration: v });
                                }}
                              >
                                <SelectTrigger className="mobile-entry-field mt-1 h-12 w-full text-base font-bold" data-testid={"mobile-lunch-" + dayIndex + "-" + entryIndex}>
                                  <SelectValue placeholder="Select lunch" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">No lunch</SelectItem>
                                  <SelectItem value="30">30 minutes</SelectItem>
                                  <SelectItem value="60">60 minutes</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-[11px]">Job</Label>
                              <Select
                                value={entry.job_number || ""}
                                disabled={isLeaveType(entry.type)}
                                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "job_number", v)}
                              >
                                <SelectTrigger className="mobile-entry-field mt-1 h-12 w-full text-base font-bold">
                                  <SelectValue placeholder="Select Job" />
                                </SelectTrigger>
                                <SelectContent>
                                  {jobNumbers.map((job) => (
                                    <SelectItem key={job.id} value={job.job_number}>
                                      {job.job_number}{job.description ? " - " + job.description : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-[11px]">Task</Label>
                              <Select
                                value={entry.task_code || ""}
                                disabled={isLeaveType(entry.type) || !entry.job_number}
                                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "task_code", v)}
                              >
                                <SelectTrigger className="mobile-entry-field mt-1 h-12 w-full text-base font-bold">
                                  <SelectValue placeholder="Select Task" />
                                </SelectTrigger>
                                <SelectContent>
                                  {getTaskCodesForEntry(entry).map((tc) => (
                                    <SelectItem key={tc.id} value={tc.code}>
                                      {tc.code} - {tc.description}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-[11px]">Project Manager</Label>
                              <Select
                                value={entry.project_manager_id || ""}
                                disabled={isLeaveType(entry.type)}
                                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "project_manager_id", v)}
                              >
                                <SelectTrigger className="mobile-entry-field mt-1 h-12 w-full text-base font-bold">
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
                            </div>

                            <div>
                              <Label className="text-[11px]">Description</Label>
                              <Textarea
                                value={entry.description || entry.other || ""}
                                onChange={(e) => updateEntry(dayIndex, entryIndex, "description", e.target.value)}
                                className="mobile-entry-field mt-1 min-h-[88px] text-base font-semibold"
                                rows={2}
                                data-testid={"mobile-description-" + dayIndex + "-" + entryIndex}
                              />
                            </div>
                          </div>

                          <div className="mobile-entry-action-row mt-3 grid grid-cols-3 gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full px-1 py-1 text-[10px]"
                              disabled={isLeaveType(entry.type)}
                              onClick={() => startEntryNow(dayIndex, entryIndex)}
                              data-testid={"mobile-start-now-" + dayIndex + "-" + entryIndex}
                            >
                              Start now
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full px-1 py-1 text-[10px]"
                              disabled={isLeaveType(entry.type)}
                              onClick={() => finishEntryNow(dayIndex, entryIndex)}
                              data-testid={"mobile-finish-now-" + dayIndex + "-" + entryIndex}
                            >
                              Finish now
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-full px-1 py-1 text-[10px] text-red-600"
                              onClick={() => removeMobileEntry(dayIndex, entryIndex)}
                              data-testid={"mobile-clear-" + dayIndex + "-" + entryIndex}
                            >
                              Clear
                            </Button>
                          </div>
                            </div>
                          )}
                        </div>
                      ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="card p-3 bg-gray-900 text-white" data-testid="timesheet-mobile-totals">
              <div className="text-sm font-bold mb-2">Totals</div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div>Work</div>
                <div className="text-right font-semibold">{getTypeTotalHours("work").toFixed(2)} hrs</div>
                <div>No Work</div>
                <div className="text-right font-semibold">{getTypeTotalHours("unpaid_day_off").toFixed(2)} hrs</div>
                <div>Public Holiday</div>
                <div className="text-right font-semibold">{getTypeTotalHours("public_holiday").toFixed(2)} hrs</div>
                <div>Annual Leave</div>
                <div className="text-right font-semibold">{getTypeTotalHours("annual_leave").toFixed(2)} hrs</div>
                <div>Sick</div>
                <div className="text-right font-semibold">{getTypeTotalHours("sick").toFixed(2)} hrs</div>
                <div className="border-t border-white/20 pt-2 font-bold">TOTAL HOURS</div>
                <div className="border-t border-white/20 pt-2 text-right text-base font-bold">{getTotalHours().toFixed(2)} hrs</div>
              </div>
            </div>
          </div>          {/* Timesheet Grid */}
          <div className="hidden lg:block card mb-6 overflow-x-auto" data-testid="timesheet-grid">
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
    <React.Fragment key={day.day || dayIndex}>
      {(!day.entries || day.entries.length === 0) && (
        <tr className="border-b bg-gray-50" data-testid={"desktop-empty-day-" + dayIndex}>
          <td className="p-2 font-medium">{day.day}</td>
          <td colSpan="9" className="p-2 text-sm font-semibold text-gray-600">
            No entries for this day.
          </td>
          <td className="p-2">
            <Button type="button" size="sm" variant="outline" onClick={() => addEntry(dayIndex)} data-testid={"desktop-add-entry-empty-" + dayIndex}>
              Add Task Entry
            </Button>
          </td>
        </tr>
      )}
      {(day.entries || []).map((entry, entryIndex) => (
        <tr key={`${dayIndex}-${entryIndex}`} className="border-b hover:bg-gray-50">

          {entryIndex === 0 && (
            <td className="p-1 font-medium bg-gray-50" rowSpan={day.entries.length}>
              {day.day}
            </td>
          )}

          {/* TYPE */}
          <td className="p-1">
            <select
              value={entry.type || ""}
              onChange={(e) => updateEntry(dayIndex, entryIndex, "type", e.target.value)}
              className="w-28 text-[11px] border rounded px-1 py-0.5"
            >
              <option value="" disabled>Select type</option>
              <option value="work">Work</option>
              <option value="unpaid_day_off">No Work</option>
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
                disabled={isLeaveType(entry.type) || !entry.job_number}
                onValueChange={(v) => updateEntry(dayIndex, entryIndex, "task_code", v)}
              >
                <SelectTrigger className="w-24 text-[11px] px-1 py-0.5">
                  <SelectValue placeholder="Select Task" />
                </SelectTrigger>
                <SelectContent>
                  {getTaskCodesForEntry(entry).map((tc) => (
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
    </React.Fragment>
  ))}

    <tr className="bg-gray-50 border-t">
  <td colSpan="5" className="p-1 text-right font-medium">Work</td>
  <td className="p-1 font-medium">{getTypeTotalHours("work").toFixed(2)}</td>
  <td colSpan="5"></td>
</tr>
<tr className="bg-gray-50">
  <td colSpan="5" className="p-1 text-right font-medium">No Work</td>
  <td className="p-1 font-medium">{getTypeTotalHours("unpaid_day_off").toFixed(2)}</td>
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
              onSignatureChange={handleEmployeeSignatureChange}
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
              {saving ? "Saving..." : isEditing ? "Update & Return for Approval" : "Submit Timesheet"}
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
























































































































































