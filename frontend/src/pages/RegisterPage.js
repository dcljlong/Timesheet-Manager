import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { useAuth, formatApiError } from "../App";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import timesheetLogo from "../assets/timesheet-manager-logo.png";
import loginBackground from "../assets/timesheet-manager-login-background.png";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("employee");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register, user } = useAuth();
  const navigate = useNavigate();

  if (user) {
    navigate("/login");
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register(email, password, name, role);
      navigate("/login");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tm-login-shell" data-testid="register-page">
      <div
        className="tm-login-background"
        style={{ backgroundImage: `url(${loginBackground})` }}
        aria-hidden="true"
      />
      <div className="tm-login-overlay" aria-hidden="true" />

      <main className="tm-login-card tm-register-card" aria-label="Create Timesheet Manager account">
        <div className="tm-login-heading">
          <p className="tm-login-kicker">A Long Line product</p>
          <h1 data-testid="register-title">Timesheet Manager</h1>
          <p>Labour & Payroll Control</p>
        </div>

        <form onSubmit={handleSubmit} className="tm-login-form">
          <button
            type="submit"
            className="tm-logo-submit tm-register-logo-submit"
            disabled={loading}
            data-testid="register-logo-submit"
            aria-label="Create Timesheet Manager account"
            title="Create Timesheet Manager account"
          >
            <img src={timesheetLogo} alt="Timesheet Manager logo" />
          </button>

          <div className="tm-login-title-block">
            <h2>Create Account</h2>
            <p>{loading ? "Creating your account..." : "Create your Long Line Timesheet access."}</p>
          </div>

          {error && (
            <div className="tm-login-error" data-testid="register-error">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="name" className="tm-login-label">Full Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="David Long"
              required
              data-testid="register-name-input"
              className="tm-login-input"
            />
          </div>

          <div>
            <Label htmlFor="email" className="tm-login-label">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.co.nz"
              required
              data-testid="register-email-input"
              className="tm-login-input"
            />
          </div>

          <div>
            <Label className="tm-login-label">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="tm-login-input" data-testid="register-role-select">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="project_manager">Project Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="password" className="tm-login-label">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                data-testid="register-password-input"
                className="tm-login-input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="tm-login-eye-button"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="tm-login-submit"
            disabled={loading}
            data-testid="register-submit-button"
          >
            {loading ? (
              "Creating..."
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <UserPlus className="w-4 h-4" />
                Create account
              </span>
            )}
          </button>
        </form>

        <p className="tm-login-register">
          Already have access?{" "}
          <Link to="/login" data-testid="login-link">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
