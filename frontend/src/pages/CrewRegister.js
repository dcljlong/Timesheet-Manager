import { useEffect, useMemo, useState } from "react";
import { API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ChevronLeft, ChevronRight, ClipboardCopy, Download, Plus, Save, Trash2, Users } from "lucide-react";
import Layout from "../components/Layout";

// TIMESHEET MANAGER / CREW REGISTER V1
// Foreman/PM records who is on site for a job each day, with hours for Westaco
// crew and headcount for subbies, then copies a basic or full message for the office.

const pad = (n) => String(n).padStart(2, "0");
const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIsoDate(new Date());
const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
};
const weekRange = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - offset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [toIsoDate(monday), toIsoDate(sunday)];
};
const dateLabel = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });

const minutes = (t) => {
  if (!t || !t.includes(":")) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const calcHours = (start, finish, lunch) => {
  const s = minutes(start);
  const f = minutes(finish);
  if (s === null || f === null || f <= s) return 0;
  return Math.max(0, Math.round(((f - s - (Number(lunch) || 0)) / 60) * 100) / 100);
};

const DEFAULTS_KEY = "tm-crew-register-defaults";
const loadDefaults = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DEFAULTS_KEY) || "null");
    if (saved && saved.start && saved.finish) return saved;
  } catch (e) {
    /* storage unavailable */
  }
  return { start: "07:00", finish: "15:30", lunch: 30, job: "" };
};

export default function CrewRegister() {
  const [defaults, setDefaults] = useState(loadDefaults);
  const [workDate, setWorkDate] = useState(todayIso);
  const [jobNumber, setJobNumber] = useState(defaults.job || "");
  const [taskCode, setTaskCode] = useState("");
  const [jobs, setJobs] = useState([]);
  const [taskCodes, setTaskCodes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [crew, setCrew] = useState({}); // key -> entry
  const [extraName, setExtraName] = useState("");
  const [subbies, setSubbies] = useState([]);
  const [notes, setNotes] = useState("");
  const [savedId, setSavedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [level, setLevel] = useState("basic");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const opts = { withCredentials: true };
    Promise.all([
      axios.get(`${API}/job-numbers`, opts),
      axios.get(`${API}/task-codes`, opts),
      axios.get(`${API}/crew-register/staff`, opts),
    ])
      .then(([j, t, s]) => {
        const activeJobs = (j.data || []).filter((x) => x.active !== false);
        setJobs(activeJobs);
        setTaskCodes(t.data || []);
        setStaff(s.data || []);
        if (!jobNumber && activeJobs.length) setJobNumber(activeJobs[0].job_number);
      })
      .catch((err) => toast.error(formatApiError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ ...defaults, job: jobNumber }));
    } catch (e) {
      /* storage unavailable */
    }
  }, [defaults, jobNumber]);

  // Load any saved register for this job and date
  useEffect(() => {
    if (!jobNumber || !workDate) return;
    let cancelled = false;
    setMessage("");
    axios
      .get(`${API}/crew-register`, { params: { work_date: workDate, job_number: jobNumber }, withCredentials: true })
      .then(({ data }) => {
        if (cancelled) return;
        const day = (data || [])[0];
        if (day) {
          const loaded = {};
          (day.crew || []).forEach((c) => {
            loaded[c.user_id || `name:${c.name.toLowerCase()}`] = {
              user_id: c.user_id || null,
              name: c.name,
              start_time: c.start_time || "",
              finish_time: c.finish_time || "",
              lunch_minutes: c.lunch_minutes ?? 30,
              job_number: c.job_number || "",
              note: c.note || "",
            };
          });
          setCrew(loaded);
          setSubbies((day.subbies || []).map((s) => ({ company: s.company, count: s.count, note: s.note || "" })));
          setNotes(day.notes || "");
          setTaskCode(day.task_code || "");
          setSavedId(day.id);
        } else {
          setCrew({});
          setSubbies([]);
          setNotes("");
          setSavedId(null);
        }
        setDirty(false);
      })
      .catch((err) => !cancelled && toast.error(formatApiError(err)));
    return () => {
      cancelled = true;
    };
  }, [jobNumber, workDate]);

  // Refresh the message whenever a saved, unchanged register or the level changes
  useEffect(() => {
    if (!savedId || dirty) return;
    axios
      .get(`${API}/crew-register/${savedId}/message`, { params: { level }, withCredentials: true })
      .then(({ data }) => setMessage(data.text || ""))
      .catch(() => setMessage(""));
  }, [savedId, level, dirty]);

  const touch = () => {
    setDirty(true);
    setMessage("");
  };

  const toggleStaff = (person) => {
    touch();
    setCrew((prev) => {
      const next = { ...prev };
      if (next[person.id]) {
        delete next[person.id];
      } else {
        next[person.id] = {
          user_id: person.id,
          name: person.name,
          start_time: defaults.start,
          finish_time: defaults.finish,
          lunch_minutes: defaults.lunch,
          job_number: "",
          note: "",
        };
      }
      return next;
    });
  };

  const addExtra = () => {
    const name = extraName.trim();
    if (!name) return;
    const key = `name:${name.toLowerCase()}`;
    if (crew[key]) {
      toast.error(`${name} is already on the list`);
      return;
    }
    touch();
    setCrew((prev) => ({
      ...prev,
      [key]: { user_id: null, name, start_time: defaults.start, finish_time: defaults.finish, lunch_minutes: defaults.lunch, job_number: "", note: "" },
    }));
    setExtraName("");
  };

  const updateCrew = (key, field, value) => {
    touch();
    setCrew((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const removeCrew = (key) => {
    touch();
    setCrew((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const applyDefaultsToAll = () => {
    touch();
    setCrew((prev) => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        next[k] = { ...v, start_time: defaults.start, finish_time: defaults.finish, lunch_minutes: defaults.lunch };
      });
      return next;
    });
  };

  const updateSubbie = (idx, field, value) => {
    touch();
    setSubbies((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const crewEntries = useMemo(
    () => Object.entries(crew).sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [crew]
  );
  const extraCrew = crewEntries.filter(([, c]) => !c.user_id);
  const westacoCount = crewEntries.length;
  const subbieCount = subbies.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const totalHours = crewEntries.reduce((sum, [, c]) => sum + calcHours(c.start_time, c.finish_time, c.lunch_minutes), 0);

  const handleSave = async () => {
    if (!jobNumber) {
      toast.error("Pick a job first");
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(
        `${API}/crew-register`,
        {
          work_date: workDate,
          job_number: jobNumber,
          task_code: taskCode || null,
          crew: crewEntries.map(([, c]) => ({
            user_id: c.user_id,
            name: c.name,
            start_time: c.start_time || null,
            finish_time: c.finish_time || null,
            lunch_minutes: Number(c.lunch_minutes) || 0,
            job_number: c.job_number || null,
            note: c.note || null,
          })),
          subbies: subbies
            .filter((s) => (s.company || "").trim())
            .map((s) => ({ company: s.company.trim(), count: Number(s.count) || 0, note: s.note || null })),
          notes: notes || null,
        },
        { withCredentials: true }
      );
      setSavedId(data.id);
      setDirty(false);
      toast.success(`Saved – ${data.total_on_site} on site`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Copied – paste it into your text or email to Dan");
    } catch (e) {
      const el = document.getElementById("crew-message-text");
      if (el) {
        el.focus();
        el.select();
      }
      toast.message("Text selected – tap Copy to copy it");
    }
  };

  const handleExportWeek = async () => {
    const [from, to] = weekRange(workDate);
    try {
      const response = await axios.get(`${API}/crew-register/export.csv`, {
        params: { date_from: from, date_to: to, job_number: jobNumber || undefined },
        withCredentials: true,
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `crew_register_${jobNumber || "all-jobs"}_${from}_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const jobLabel = (j) => (j.description ? `${j.job_number} – ${j.description}` : j.job_number);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-4 pb-28" data-testid="crew-register-page">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Crew Register
          </h1>
          <p className="text-gray-500 text-sm">Who's on site today, their hours, and a message for the office.</p>
        </div>

        {/* Day and job */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setWorkDate((d) => shiftDate(d, -1))} aria-label="Previous day">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Input
              id="crew-date"
              type="date"
              value={workDate}
              onChange={(e) => e.target.value && setWorkDate(e.target.value)}
              className="flex-1"
              data-testid="crew-date-input"
            />
            <Button variant="outline" size="sm" onClick={() => setWorkDate((d) => shiftDate(d, 1))} aria-label="Next day">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="crew-job">Job</Label>
              <select
                id="crew-job"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                data-testid="crew-job-select"
              >
                {!jobs.length && <option value="">No jobs set up</option>}
                {jobs.map((j) => (
                  <option key={j.id} value={j.job_number}>
                    {jobLabel(j)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="crew-task">Task code (optional)</Label>
              <select
                id="crew-task"
                value={taskCode}
                onChange={(e) => {
                  setTaskCode(e.target.value);
                  touch();
                }}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                data-testid="crew-task-select"
              >
                <option value="">None</option>
                {taskCodes.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.code} – {t.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-gray-100">
            <div>
              <Label htmlFor="crew-default-start" className="text-xs">Usual start</Label>
              <Input id="crew-default-start" type="time" value={defaults.start} onChange={(e) => setDefaults((d) => ({ ...d, start: e.target.value }))} className="mt-1 w-28" />
            </div>
            <div>
              <Label htmlFor="crew-default-finish" className="text-xs">Usual finish</Label>
              <Input id="crew-default-finish" type="time" value={defaults.finish} onChange={(e) => setDefaults((d) => ({ ...d, finish: e.target.value }))} className="mt-1 w-28" />
            </div>
            <div>
              <Label htmlFor="crew-default-lunch" className="text-xs">Lunch</Label>
              <select
                id="crew-default-lunch"
                value={defaults.lunch}
                onChange={(e) => setDefaults((d) => ({ ...d, lunch: Number(e.target.value) }))}
                className="mt-1 border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
              >
                <option value={0}>None</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hr</option>
              </select>
            </div>
            {westacoCount > 0 && (
              <Button variant="outline" size="sm" onClick={applyDefaultsToAll}>
                Apply to all
              </Button>
            )}
          </div>
        </div>

        {/* Westaco crew */}
        <div className="card p-4 space-y-3" data-testid="crew-staff-list">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Westaco crew</h2>
            <span className="text-sm text-gray-500 tabular-nums">
              {westacoCount} on · {totalHours.toFixed(1)} hrs
            </span>
          </div>
          {staff.length === 0 && <p className="text-sm text-gray-500">No staff found. Add people under Users, or type a name below.</p>}
          <div className="divide-y divide-gray-100">
            {[...staff.map((p) => [p.id, p]), ...extraCrew.map(([k, c]) => [k, { id: k, name: c.name, extra: true }])].map(([key, person]) => {
              const entry = crew[key];
              const hours = entry ? calcHours(entry.start_time, entry.finish_time, entry.lunch_minutes) : 0;
              return (
                <div key={key} className="py-2" data-testid={`crew-row-${person.name}`}>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-gray-900"
                      checked={Boolean(entry)}
                      onChange={() => (person.extra ? removeCrew(key) : toggleStaff(person))}
                      aria-label={`${person.name} on site`}
                    />
                    <span className={`flex-1 ${entry ? "font-medium" : "text-gray-600"}`}>{person.name}</span>
                    {entry && <span className="text-sm tabular-nums text-gray-700">{hours.toFixed(2).replace(/\.?0+$/, "")}h</span>}
                  </label>
                  {entry && (
                    <div className="mt-2 ml-8 grid grid-cols-3 gap-2">
                      <Input type="time" value={entry.start_time} onChange={(e) => updateCrew(key, "start_time", e.target.value)} aria-label={`${person.name} start`} />
                      <Input type="time" value={entry.finish_time} onChange={(e) => updateCrew(key, "finish_time", e.target.value)} aria-label={`${person.name} finish`} />
                      <select
                        value={entry.lunch_minutes}
                        onChange={(e) => updateCrew(key, "lunch_minutes", Number(e.target.value))}
                        className="border border-gray-300 rounded-md px-2 text-sm bg-white"
                        aria-label={`${person.name} lunch`}
                      >
                        <option value={0}>No lunch</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 hr</option>
                      </select>
                      <select
                        value={entry.job_number}
                        onChange={(e) => updateCrew(key, "job_number", e.target.value)}
                        className="col-span-3 sm:col-span-1 border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
                        aria-label={`${person.name} job`}
                      >
                        <option value="">Same job</option>
                        {jobs.filter((j) => j.job_number !== jobNumber).map((j) => (
                          <option key={j.id} value={j.job_number}>
                            {jobLabel(j)}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="col-span-3 sm:col-span-2"
                        placeholder="Note (optional)"
                        value={entry.note}
                        onChange={(e) => updateCrew(key, "note", e.target.value)}
                        aria-label={`${person.name} note`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Someone not on the list"
              value={extraName}
              onChange={(e) => setExtraName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExtra()}
              data-testid="crew-extra-name"
            />
            <Button variant="outline" onClick={addExtra} disabled={!extraName.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>

        {/* Subbies */}
        <div className="card p-4 space-y-3" data-testid="crew-subbies">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Subbies</h2>
            <span className="text-sm text-gray-500 tabular-nums">{subbieCount} on</span>
          </div>
          {subbies.map((s, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_4.5rem_auto] gap-2 items-start">
              <Input placeholder="Company" value={s.company} onChange={(e) => updateSubbie(idx, "company", e.target.value)} aria-label="Subbie company" />
              <Input type="number" min="0" inputMode="numeric" value={s.count} onChange={(e) => updateSubbie(idx, "count", e.target.value)} aria-label="Headcount" />
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500"
                onClick={() => {
                  touch();
                  setSubbies((prev) => prev.filter((_, i) => i !== idx));
                }}
                aria-label="Remove subbie"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Input className="col-span-3" placeholder="What they're doing (optional)" value={s.note} onChange={(e) => updateSubbie(idx, "note", e.target.value)} aria-label="Subbie note" />
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => {
              touch();
              setSubbies((prev) => [...prev, { company: "", count: 1, note: "" }]);
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add subbie
          </Button>
        </div>

        {/* Notes */}
        <div className="card p-4">
          <Label htmlFor="crew-notes">Notes for the day (optional)</Label>
          <textarea
            id="crew-notes"
            rows={2}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              touch();
            }}
            placeholder="e.g. Scissor lift on hire, rain stopped work at 2pm"
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>

        {/* Message */}
        <div className="card p-4 space-y-3" data-testid="crew-message">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Message for Dan</h2>
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden" role="group" aria-label="Message detail">
              {["basic", "full"].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`px-3 py-1.5 text-sm capitalize ${level === l ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}
                  aria-pressed={level === l}
                  data-testid={`crew-level-${l}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {savedId && !dirty && message ? (
            <>
              <textarea
                id="crew-message-text"
                readOnly
                value={message}
                rows={Math.min(14, message.split("\n").length + 1)}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm font-mono bg-gray-50"
                data-testid="crew-message-text"
              />
              <Button onClick={handleCopy} className="w-full bg-gray-900 hover:bg-gray-800" data-testid="crew-copy-button">
                <ClipboardCopy className="w-4 h-4 mr-2" />
                Copy message
              </Button>
            </>
          ) : (
            <p className="text-sm text-gray-500">{dirty ? "Save the register to update the message." : "Save the register to make the message."}</p>
          )}
          <Button variant="outline" onClick={handleExportWeek} className="w-full" data-testid="crew-export-week">
            <Download className="w-4 h-4 mr-2" />
            Export this week's hours (CSV)
          </Button>
        </div>
      </div>

      {/* Save bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 border-t border-gray-200 px-4 py-3 backdrop-blur" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1 text-sm">
            <div className="font-semibold tabular-nums" data-testid="crew-total">{westacoCount + subbieCount} on site</div>
            <div className="text-gray-500 text-xs">
              {dateLabel(workDate)} · {jobNumber || "no job"} {dirty ? "· not saved" : savedId ? "· saved" : ""}
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving || !jobNumber} className="bg-gray-900 hover:bg-gray-800" data-testid="crew-save-button">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
