import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../App";
import { LogOut, Settings, FileText, Users, ClipboardList, Home, UserCog, Layers } from "lucide-react";
import { Button } from "../components/ui/button";
import timesheetLogo from "../assets/timesheet-manager-logo.png";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
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
      { path: "/admin/pms", label: "Project Managers", icon: UserCog },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  };

  const roleNavItems = navItems[user?.role] || navItems.employee;

  const suiteLinks = [
    { href: "http://localhost:3003/dashboard", label: "LLD", description: "Long Line Diary / Site diary" },
    { href: "http://localhost:3002/dashboard", label: "Tool Tracker", description: "Tool control" },
    { href: "http://localhost:3004/login", label: "FitoutOS", description: "Fitout planning" },
  ];

  return (
    <div className="tm-app-shell" data-testid="app-layout">
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

              <div className="tm-nav-divider" aria-hidden="true" />

              {suiteLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="tm-suite-link"
                  title={item.description}
                  data-testid={`suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="tm-nav-user">
            <span className="tm-user-name" data-testid="user-name">
              {user?.name}
            </span>
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

          {suiteLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="tm-mobile-suite-link"
              data-testid={`mobile-suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <main className="tm-main-content">
        {children}
      </main>
    </div>
  );
}
