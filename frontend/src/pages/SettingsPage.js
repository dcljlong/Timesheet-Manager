import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API, formatApiError } from "../App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { ArrowLeft, Bell, Save } from "lucide-react";
import Layout from "../components/Layout";
import { playTimesheetReminderSound } from "../lib/reminderSound";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const defaultSettings = {
    reminder_time: "17:00",
    reminder_day: "Friday",
    reminder_frequency: "weekly",
    enabled: true
  };

  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await axios.get(`${API}/notification-settings`, { withCredentials: true });
        if (data) {
          setSettings({
            reminder_time: "17:00",
            reminder_day: "Friday",
            reminder_frequency: "weekly",
            enabled: true,
            ...data,
          });
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...defaultSettings,
        ...settings,
        reminder_frequency: settings.reminder_frequency || "weekly",
        reminder_day: settings.reminder_day || "Friday",
        reminder_time: settings.reminder_time || "17:00",
        enabled: settings.enabled !== false,
      };

      await axios.put(`${API}/notification-settings`, payload, { withCredentials: true });
      setSettings(payload);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  // Test notification sound
  const playTestSound = async () => {
    try {
      await playTimesheetReminderSound();
      toast.success("Loud reminder sound played");
    } catch (err) {
      console.error("Reminder sound failed:", err);
      toast.error("Sound blocked by the browser. Tap the page and try again.");
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
      <div className="fade-in max-w-2xl" data-testid="settings-page">
        {/* Header */}
        <div className="flex items-center mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)} className="mr-4" data-testid="back-button">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="settings-title">
            Settings
          </h1>
        </div>

        {/* Notification Settings Card */}
        <div className="card p-6 mb-6">
          <div className="flex items-center mb-4">
            <Bell className="w-5 h-5 mr-2 text-gray-700" />
            <h2 className="text-lg font-semibold">Notification Settings</h2>
          </div>
          
          <p className="text-sm text-gray-500 mb-6">
            Configure daily or weekly app-open reminders. V1 reminders work while Timesheet Manager is open in the browser.
          </p>

          <div className="space-y-6">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable Reminders</Label>
                <p className="text-sm text-gray-500">Play a loud reminder in this browser when the reminder is due</p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
                data-testid="reminder-enabled-switch"
              />
            </div>

            {/* Reminder Frequency */}
            <div>
              <Label>Reminder Frequency</Label>
              <Select
                value={settings.reminder_frequency || "weekly"}
                onValueChange={(v) => setSettings({ ...settings, reminder_frequency: v })}
                disabled={!settings.enabled}
              >
                <SelectTrigger className="mt-1 w-full" data-testid="reminder-frequency-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-500">
                Daily reminds every day at the selected time. Weekly reminds on the selected day and time.
              </p>
            </div>

            {/* Reminder Day */}
            <div>
              <Label>Weekly Reminder Day</Label>
              <Select
                value={settings.reminder_day || "Friday"}
                onValueChange={(v) => setSettings({ ...settings, reminder_day: v })}
                disabled={!settings.enabled || (settings.reminder_frequency || "weekly") === "daily"}
              >
                <SelectTrigger className="mt-1 w-full" data-testid="reminder-day-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => (
                    <SelectItem key={day} value={day}>{day}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-500">
                Day is only used for weekly reminders.
              </p>
            </div>

            {/* Reminder Time */}
            <div>
              <Label>Reminder Time</Label>
              <Input
                type="time"
                value={settings.reminder_time}
                onChange={(e) => setSettings({ ...settings, reminder_time: e.target.value })}
                disabled={!settings.enabled}
                className="mt-1"
                data-testid="reminder-time-input"
              />
            </div>

            {/* Test Sound */}
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={playTestSound}
                data-testid="test-sound-button"
              >
                <Bell className="w-4 h-4 mr-2" />
                Test Loud Reminder Sound
              </Button>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Account Information</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">Name</p>
              <p className="font-medium">{user?.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Email</p>
              <p className="font-medium">{user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Role</p>
              <p className="font-medium capitalize">{user?.role?.replace("_", " ")}</p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            className="bg-gray-900 hover:bg-gray-800"
            disabled={saving}
            data-testid="save-settings-button"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
