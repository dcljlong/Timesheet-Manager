import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

const emptyEntry = () => ({
  start_time: "",
  lunch_duration: "",
  finish_time: "",
  total_hours: 0,
  job_number: "",
  task_code: "",
  project_manager_id: "",
  other: ""
});

const initialDays = () => DAYS.map(day => ({ day, entries: [emptyEntry()] }));

export default function TimesheetForm() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const signatureRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskCodes, setTaskCodes] = useState([]);
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

  // New task code modal
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCodeValue, setNewCodeValue] = useState("");
  const [newCodeDesc, setNewCodeDesc] = useState("");

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [codesRes, pmsRes, defaultsRes] = await Promise.all([
        axios.get(`${API}/task-codes`, { withCredentials: true }),
        axios.get(`${API}/project-managers`, { withCredentials: true }),
        axios.get(`${API}/user-defaults`, { withCredentials: true })
      ]);
      
      setTaskCodes(codesRes.data);
      setPMs(pmsRes.data);
      
      if (defaultsRes.data && !isEditing) {
        setDefaults(defaultsRes.data);
        if (defaultsRes.data.employee_name) setEmployeeName(defaultsRes.data.employee_name);
        if (defaultsRes.data.period_type) setPeriodType(defaultsRes.data.period_type);
      }

      if (isEditing) {
        const tsRes = await axios.get(`${API}/timesheets/${id}`, { withCredentials: true });
        const ts = tsRes.data;
        setEmployeeName(ts.employee_name);
        setPeriodType(ts.period_type);
        setWeekEnding(new Date(ts.week_ending));
        setDays(ts.days.map(d => ({
          ...d,
          entries: d.entries.length > 0 ? d.entries : [emptyEntry()]
        })));
        setMessages(ts.messages || "");
        setNightsAway(ts.nights_away || 0);
        setEmployeeSignature(ts.employee_signature);
      } else {
        // Set default week ending to next Sunday
        const today = new Date();
        const nextSun = isSunday(today) ? today : nextSunday(today);
        setWeekEnding(nextSun);
      }
    } catch (err) {
      toast.error("Failed to load data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const calculateHours = (start, finish, lunch) => {
    if (!start || !finish) return 0;
    
    const [startH, startM] = start.split(":").map(Number);
    const [finishH, finishM] = finish.split(":").map(Number);
    
    let hours = finishH - startH + (finishM - startM) / 60;
    if (lunch) {
      hours -= parseInt(lunch) / 60;
    }
    
    return Math.max(0, hours);
  };

  const updateEntry = (dayIndex, entryIndex, field, value) => {
    const newDays = [...days];
    const entry = { ...newDays[dayIndex].entries[entryIndex] };
    entry[field] = value;
    
    // Recalculate hours if time fields change
    if (["start_time", "finish_time", "lunch_duration"].includes(field)) {
      entry.total_hours = calculateHours(entry.start_time, entry.finish_time, entry.lunch_duration);
    }
    
    newDays[dayIndex].entries[entryIndex] = entry;
    setDays(newDays);
  };

  const addEntry = (dayIndex) => {
    const newDays = [...days];
    newDays[dayIndex].entries.push(emptyEntry());
    setDays(newDays);
  };

  const removeEntry = (dayIndex, entryIndex) => {
    const newDays = [...days];
    if (newDays[dayIndex].entries.length > 1) {
      newDays[dayIndex].entries.splice(entryIndex, 1);
      setDays(newDays);
    }
  };

  const getDayTotal = (dayIndex) => {
    return days[dayIndex].entries.reduce((sum, e) => sum + (e.total_hours || 0), 0);
  };

  const getRunningTotal = (upToDayIndex) => {
    let total = 0;
    for (let i = 0; i <= upToDayIndex; i++) {
      total += getDayTotal(i);
    }
    return total;
  };

  const getTotalHours = () => {
    return days.reduce((sum, day) => sum + day.entries.reduce((s, e) => s + (e.total_hours || 0), 0), 0);
  };

  const handleAddTaskCode = async () => {
    if (!newCodeValue.trim() || !newCodeDesc.trim()) {
      toast.error("Please fill in both code and description");
      return;
    }
    try {
      const { data } = await axios.post(`${API}/task-codes`, {
        code: newCodeValue,
        description: newCodeDesc
      }, { withCredentials: true });
      setTaskCodes([...taskCodes, data]);
      setNewCodeValue("");
      setNewCodeDesc("");
      setShowNewCode(false);
      toast.success("Task code added");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!weekEnding) {
      toast.error("Please select week ending date");
      return;
    }
    
    if (!employeeSignature) {
      toast.error("Please sign the timesheet before submitting");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        employee_name: employeeName,
        period_type: periodType,
        week_ending: weekEnding.toISOString(),
        days: days,
        messages: messages,
        nights_away: parseInt(nightsAway) || 0,
        total_hours: getTotalHours(),
        employee_signature: employeeSignature
      };

      if (isEditing) {
        await axios.put(`${API}/timesheets/${id}`, payload, { withCredentials: true });
        toast.success("Timesheet updated");
      } else {
        await axios.post(`${API}/timesheets`, payload, { withCredentials: true });
        toast.success("Timesheet submitted");
      }
      navigate("/employee");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
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
      <div className="fade-in" data-testid="timesheet-form">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="form-title">
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
                <Input
                  id="employeeName"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  required
                  className="mt-1"
                  data-testid="employee-name-input"
                />
              </div>

              <div>
                <Label>Period Type</Label>
                <Select value={periodType} onValueChange={setPeriodType}>
                  <SelectTrigger className="mt-1" data-testid="period-type-select">
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
                        // Always select the Sunday
                        if (date) {
                          const sunday = isSunday(date) ? date : nextSunday(date);
                          setWeekEnding(sunday);
                        }
                      }}
                      disabled={(date) => !isSunday(date)}
                      data-testid="week-ending-calendar"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <Label htmlFor="nightsAway">Nights Away</Label>
                <Input
                  id="nightsAway"
                  type="number"
                  min="0"
                  value={nightsAway}
                  onChange={(e) => setNightsAway(e.target.value)}
                  className="mt-1"
                  data-testid="nights-away-input"
                />
              </div>
            </div>
          </div>

          {/* Timesheet Grid */}
          <div className="card mb-6 overflow-x-auto" data-testid="timesheet-grid">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="p-3 text-left font-semibold">Day</th>
                  <th className="p-3 text-left font-semibold">Start</th>
                  <th className="p-3 text-left font-semibold">Lunch</th>
                  <th className="p-3 text-left font-semibold">Finish</th>
                  <th className="p-3 text-left font-semibold">Hours</th>
                  <th className="p-3 text-left font-semibold">Job No.</th>
                  <th className="p-3 text-left font-semibold">Task Code</th>
                  <th className="p-3 text-left font-semibold">PM</th>
                  <th className="p-3 text-left font-semibold">Other</th>
                  <th className="p-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, dayIndex) => (
                  <>
                    {day.entries.map((entry, entryIndex) => (
                      <tr key={`${dayIndex}-${entryIndex}`} className="border-b hover:bg-gray-50" data-testid={`entry-row-${dayIndex}-${entryIndex}`}>
                        {entryIndex === 0 && (
                          <td className="p-3 font-medium bg-gray-50" rowSpan={day.entries.length}>
                            {day.day}
                          </td>
                        )}
                        <td className="p-2">
                          <Input
                            type="time"
                            value={entry.start_time}
                            onChange={(e) => updateEntry(dayIndex, entryIndex, "start_time", e.target.value)}
                            className="w-24"
                            data-testid={`start-time-${dayIndex}-${entryIndex}`}
                          />
                        </td>
                        <td className="p-2">
                          <Select
                            value={entry.lunch_duration}
                            onValueChange={(v) => updateEntry(dayIndex, entryIndex, "lunch_duration", v)}
                          >
                            <SelectTrigger className="w-20" data-testid={`lunch-${dayIndex}-${entryIndex}`}>
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None</SelectItem>
                              <SelectItem value="30">30m</SelectItem>
                              <SelectItem value="60">1hr</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Input
                            type="time"
                            value={entry.finish_time}
                            onChange={(e) => updateEntry(dayIndex, entryIndex, "finish_time", e.target.value)}
                            className="w-24"
                            data-testid={`finish-time-${dayIndex}-${entryIndex}`}
                          />
                        </td>
                        <td className="p-2 font-medium text-center" data-testid={`hours-${dayIndex}-${entryIndex}`}>
                          {entry.total_hours.toFixed(2)}
                        </td>
                        <td className="p-2">
                          <Input
                            value={entry.job_number}
                            onChange={(e) => updateEntry(dayIndex, entryIndex, "job_number", e.target.value)}
                            className="w-24"
                            placeholder="Job #"
                            data-testid={`job-number-${dayIndex}-${entryIndex}`}
                          />
                        </td>
                        <td className="p-2">
                          <Select
                            value={entry.task_code}
                            onValueChange={(v) => {
                              if (v === "__new__") {
                                setShowNewCode(true);
                              } else {
                                updateEntry(dayIndex, entryIndex, "task_code", v);
                              }
                            }}
                          >
                            <SelectTrigger className="w-28" data-testid={`task-code-${dayIndex}-${entryIndex}`}>
                              <SelectValue placeholder="Code" />
                            </SelectTrigger>
                            <SelectContent>
                              {taskCodes.map((tc) => (
                                <SelectItem key={tc.id} value={tc.code}>
                                  {tc.code}
                                </SelectItem>
                              ))}
                              <SelectItem value="__new__" className="text-blue-600">
                                + Add New
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Select
                            value={entry.project_manager_id}
                            onValueChange={(v) => updateEntry(dayIndex, entryIndex, "project_manager_id", v)}
                          >
                            <SelectTrigger className="w-24" data-testid={`pm-${dayIndex}-${entryIndex}`}>
                              <SelectValue placeholder="PM" />
                            </SelectTrigger>
                            <SelectContent>
                              {projectManagers.map((pm) => (
                                <SelectItem key={pm.id} value={pm.id}>
                                  {pm.initials}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Input
                            value={entry.other}
                            onChange={(e) => updateEntry(dayIndex, entryIndex, "other", e.target.value)}
                            className="w-32"
                            placeholder="Notes"
                            data-testid={`other-${dayIndex}-${entryIndex}`}
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex space-x-1">
                            {entryIndex === day.entries.length - 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => addEntry(dayIndex)}
                                data-testid={`add-entry-${dayIndex}`}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            )}
                            {day.entries.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeEntry(dayIndex, entryIndex)}
                                className="text-red-500 hover:text-red-700"
                                data-testid={`remove-entry-${dayIndex}-${entryIndex}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Day Total Row */}
                    <tr className="bg-green-50 border-b">
                      <td colSpan="4" className="p-2 text-right font-medium text-green-800">
                        {day.day} Total:
                      </td>
                      <td className="p-2 font-bold text-green-800" data-testid={`day-total-${dayIndex}`}>
                        {getDayTotal(dayIndex).toFixed(2)}
                      </td>
                      <td colSpan="4" className="p-2 text-right text-sm text-green-700">
                        Running Total: {getRunningTotal(dayIndex).toFixed(2)} hrs
                      </td>
                      <td></td>
                    </tr>
                  </>
                ))}
                {/* Grand Total Row */}
                <tr className="bg-gray-900 text-white">
                  <td colSpan="4" className="p-3 text-right font-bold">
                    TOTAL HOURS FOR WEEK:
                  </td>
                  <td className="p-3 font-bold text-lg" data-testid="total-hours">
                    {getTotalHours().toFixed(2)}
                  </td>
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
              onChange={(e) => setMessages(e.target.value)}
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

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline" onClick={() => navigate(-1)} data-testid="cancel-button">
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
              <div className="space-y-4">
                <div>
                  <Label htmlFor="newCode">Code</Label>
                  <Input
                    id="newCode"
                    value={newCodeValue}
                    onChange={(e) => setNewCodeValue(e.target.value)}
                    placeholder="e.g., 120"
                    className="mt-1"
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
                    className="mt-1"
                    data-testid="new-code-desc-input"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <Button variant="outline" onClick={() => setShowNewCode(false)} data-testid="cancel-new-code">
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
