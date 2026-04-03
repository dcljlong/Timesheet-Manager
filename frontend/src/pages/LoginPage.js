import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, formatApiError } from "../App";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
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
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left side - Image */}
      <div 
        className="hidden lg:flex lg:w-1/2 bg-cover bg-center"
        style={{ 
          backgroundImage: `url('https://images.unsplash.com/photo-1766936587760-fcc13617ca3b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBidWlsZGluZyUyMGFyY2hpdGVjdHVyZSUyMGNvbnN0cnVjdGlvbnxlbnwwfHx8fDE3NzUyMTEyNDB8MA&ixlib=rb-4.1.0&q=85')` 
        }}
      >
        <div className="w-full h-full bg-black/40 flex items-end p-12">
          <div className="text-white">
            <h1 className="text-4xl font-bold mb-2">Timesheet Manager</h1>
            <p className="text-lg text-white/80">Track your hours, get approvals, stay organized.</p>
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#FAFAFA]">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900" data-testid="login-title">Sign In</h2>
            <p className="text-gray-500 mt-1">Enter your credentials to access your account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm" data-testid="login-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                data-testid="login-email-input"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                data-testid="login-password-input"
                className="mt-1"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800"
              disabled={loading}
              data-testid="login-submit-button"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don't have an account?{" "}
            <Link to="/register" className="text-gray-900 font-medium hover:underline" data-testid="register-link">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
