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

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    reminder_time: "17:00",
    reminder_day: "Friday",
    enabled: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await axios.get(`${API}/notification-settings`, { withCredentials: true });
      if (data) {
        setSettings(data);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/notification-settings`, settings, { withCredentials: true });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  // Test notification sound
  const playTestSound = () => {
    const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleAoAPJnUqXhQChIpmMSsfmY4KF2XsaBzYEY3XJKcimtfV1RphZN+bWJbZX2Oj3tsZ2Z0g4yCd3Bvdn6Bf3l1dXl9fnx6eHl6e3t7enp6ent7e3t7e3t7e3t7");
    audio.volume = 0.5;
    audio.play().catch(() => {});
    toast.info("Test notification sound played");
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
            Configure when you want to receive reminder notifications if you haven't submitted your timesheet.
          </p>

          <div className="space-y-6">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable Reminders</Label>
                <p className="text-sm text-gray-500">Get audible notifications for timesheet submission</p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
                data-testid="reminder-enabled-switch"
              />
            </div>

            {/* Reminder Day */}
            <div>
              <Label>Reminder Day</Label>
              <Select
                value={settings.reminder_day}
                onValueChange={(v) => setSettings({ ...settings, reminder_day: v })}
                disabled={!settings.enabled}
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
                Test Notification Sound
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
