import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, useTheme } from "../App";
import { LogOut, Settings, FileText, Users, ClipboardList, Home, UserCog, Layers, Sun, Moon, Wrench, Briefcase, MessageSquare } from "lucide-react";
import { Button } from "../components/ui/button";
import timesheetLogo from "../assets/timesheet-manager-logo.png";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleFeedbackClick = () => {
    const subject = encodeURIComponent("[Timesheet Manager Feedback] Pilot feedback");
    const body = encodeURIComponent([
      "App: Timesheet Manager",
      `Page: ${location.pathname}`,
      `User: ${user?.email || displayName || "Unknown"}`,
      "",
      "Feedback type:",
      "What happened:",
      "What did you expect:",
      "How urgent:",
    ].join("\n"));

    window.location.href = `mailto:longlinesuite.feedback@gmail.com?subject=${subject}&body=${body}`;
  };

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + "/");

  const navItems = {
    employee: [
      { path: "/employee", label: "Dashboard", icon: Home },
      { path: "/timesheet/new", label: "New Timesheet", icon: FileText },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
    project_manager: [
      { path: "/employee", label: "My Timesheets", icon: FileText },
      { path: "/pm", label: "Approvals", icon: ClipboardList },
      { path: "/timesheet/new", label: "New Timesheet", icon: FileText },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
    admin: [
      { path: "/admin", label: "Dashboard", icon: Home },
      { path: "/employee", label: "My Timesheets", icon: FileText },
      { path: "/pm", label: "PM Approvals", icon: ClipboardList },
      { path: "/admin/users", label: "Users", icon: Users },
      { path: "/admin/task-codes", label: "Task Codes", icon: Layers },
      { path: "/admin/job-numbers", label: "Job Numbers", icon: Briefcase },
      { path: "/admin/pms", label: "Project Managers", icon: UserCog },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  };

  const roleNavItems = navItems[user?.role] || navItems.employee;

  const suiteLinks = [
    {
      href: process.env.REACT_APP_LONG_LINE_DIARY_URL || "http://localhost:3003/dashboard",
      label: "LLD",
      description: "Long Line Diary / Site diary",
      icon: FileText
    },
    {
      href: process.env.REACT_APP_TOOL_TRACKER_URL || "http://localhost:3002/dashboard",
      label: "Tool Tracker",
      description: "Tool control",
      icon: Wrench
    },
    {
      href: process.env.REACT_APP_FITOUTOS_URL || "http://localhost:3004/login",
      label: "FitoutOS",
      description: "Fitout planning",
      icon: Briefcase
    },
  ];

  const visibleSuiteLinks = user?.role === "admin" || user?.role === "project_manager" ? suiteLinks : [];
  const displayName = user?.name || user?.email || "Timesheet User";
  const roleLabel = (user?.role || "user").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="tm-app-shell" data-testid="app-layout">
      <div className="tm-desktop-shell-actions" aria-label="Desktop account actions">
        <button
          type="button"
          onClick={toggleTheme}
          className="tm-desktop-theme-button"
          data-testid="desktop-theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleFeedbackClick}
          className="tm-desktop-logout-button"
          data-testid="desktop-feedback-button"
          aria-label="Send Timesheet Manager feedback"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Feedback</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="tm-desktop-logout-button"
          data-testid="desktop-logout-button"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </Button>
      </div>
      <nav className="tm-top-nav">
        <div className="tm-top-nav-inner">
          <div className="tm-nav-left">
            <Link to="/" className="tm-brand-link" data-testid="logo-link">
              <span className="tm-brand-logo">
                <img src={timesheetLogo} alt="Timesheet Manager logo" />
              </span>
              <span className="tm-brand-copy">
                <span className="tm-brand-kicker">Long Line</span>
                <span className="tm-brand-title">Timesheet</span>
                <span className="tm-brand-subtitle">Labour & Payroll Control</span>
              </span>
            </Link>

            <div className="tm-desktop-nav">
              {roleNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`tm-nav-link ${isActive(item.path) ? "active" : ""}`}
                    data-testid={`nav-${item.path.replace(/\//g, "-")}`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}

              {visibleSuiteLinks.length > 0 && <div className="tm-nav-divider" aria-hidden="true" />}

              {visibleSuiteLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="tm-suite-link"
                  title={item.description}
                  data-testid={`suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="tm-nav-user">
            <button
              type="button"
              onClick={toggleTheme}
              className="tm-theme-toggle"
              data-testid="theme-toggle"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <span className="tm-user-name" data-testid="user-name">
              {displayName}
            </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleFeedbackClick}
          className="tm-logout-button"
          data-testid="feedback-button"
          aria-label="Send Timesheet Manager feedback"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="ml-2 hidden sm:inline">Feedback</span>
        </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="tm-logout-button"
              data-testid="logout-button"
            >
              <LogOut className="w-4 h-4" />
              <span className="ml-2 hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        <div className="tm-mobile-nav">
          {roleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`tm-mobile-nav-link ${isActive(item.path) ? "active" : ""}`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}

          {visibleSuiteLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="tm-mobile-suite-link"
              data-testid={`mobile-suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="tm-shell-grid">
        <aside className="tm-desktop-brand-rail" aria-label="Timesheet Manager navigation panel">
          <div className="tm-rail-card">
            <img src={timesheetLogo} alt="Timesheet Manager logo" className="tm-rail-logo" />
            <div className="tm-rail-copy">
              <span className="tm-rail-kicker">Long Line</span>
              <span className="tm-rail-title">Timesheet</span>
              <span className="tm-rail-subtitle">Labour & Payroll Control</span>
            </div>
          </div>

          <nav className="tm-rail-nav" aria-label="Timesheet Manager main navigation">
            {roleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`tm-rail-nav-link ${isActive(item.path) ? "active" : ""}`}
                  data-testid={`rail-nav-${item.path.replace(/\//g, "-")}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {visibleSuiteLinks.length > 0 && (
            <div className="tm-rail-suite" aria-label="Long Line Suite apps">
              <p className="tm-rail-section-title">Long Line Suite</p>
              <div className="tm-rail-suite-links">
                {visibleSuiteLinks.map((item) => {
                  const SuiteIcon = item.icon;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className="tm-rail-suite-link"
                      title={item.description}
                      data-testid={`rail-suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="tm-suite-mini-mark" aria-hidden="true">
                        <SuiteIcon className="w-4 h-4" />
                      </span>
                      <span className="tm-rail-suite-link-label">{item.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tm-rail-account" aria-label="Timesheet Manager account controls">
            <p className="tm-rail-section-title">Account</p>

            <div className="tm-rail-user-block" data-testid="rail-user-name">
              <span className="tm-rail-user-name">{displayName}</span>
              <span className="tm-rail-user-role">Timesheet Manager</span>
            </div>

            <div className="tm-rail-account-actions">
              <button
                type="button"
                onClick={toggleTheme}
                className="tm-rail-theme-toggle"
                data-testid="rail-theme-toggle"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleFeedbackClick}
                className="tm-rail-logout-button"
                data-testid="rail-feedback-button"
                aria-label="Send Timesheet Manager feedback"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Feedback</span>
              </Button>


              <button
                type="button"
                onClick={handleLogout}
                className="tm-rail-logout-button"
                data-testid="rail-logout-button"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="tm-main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
