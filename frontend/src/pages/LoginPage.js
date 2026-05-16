import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth, formatApiError } from "../App";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import timesheetLogo from "../assets/timesheet-manager-logo.png";
import loginBackground from "../assets/timesheet-manager-login-background.png";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) {
    navigate("/");
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tm-login-shell" data-testid="login-page">
      <div
        className="tm-login-background"
        style={{ backgroundImage: `url(${loginBackground})` }}
        aria-hidden="true"
      />
      <div className="tm-login-overlay" aria-hidden="true" />

      <main className="tm-login-card" aria-label="Timesheet Manager login">
        <div className="tm-login-heading">
          <p className="tm-login-kicker">A Long Line product</p>
          <h1 data-testid="login-title">Timesheet Manager</h1>
          <p>Labour & Payroll Control</p>
        </div>

        <form onSubmit={handleSubmit} className="tm-login-form">
          <button
            type="submit"
            className="tm-logo-submit"
            disabled={loading}
            data-testid="login-logo-submit"
            aria-label="Sign in to Timesheet Manager"
            title="Sign in to Timesheet Manager"
          >
            <img src={timesheetLogo} alt="Timesheet Manager logo" />
          </button>

          <div className="tm-login-title-block">
            <h2>Construction Labour Hub</h2>
            <p>{loading ? "Authenticating..." : "Enter your credentials, then click Sign in."}</p>
          </div>

          {error && (
            <div className="tm-login-error" data-testid="login-error">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="email" className="tm-login-label">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.co.nz"
              required
              data-testid="login-email-input"
              className="tm-login-input"
            />
          </div>

          <div>
            <Label htmlFor="password" className="tm-login-label">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                data-testid="login-password-input"
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
            data-testid="login-submit-button"
          >
            {loading ? "Authenticating..." : <><LogIn size={16} className="mr-2" /> Sign in</>}
          </button>
        </form>

        {process.env.REACT_APP_ALLOW_PUBLIC_REGISTRATION === "true" && (
          <p className="tm-login-register">
            New to Timesheet Manager?{" "}
            <Link to="/register" data-testid="register-link">
              Create account
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
