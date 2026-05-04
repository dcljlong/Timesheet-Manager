import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, API } from "../App";
import axios from "axios";
import { LogOut, Settings, FileText, Users, ClipboardList, Home, UserCog, Layers } from "lucide-react";
import { Button } from "../components/ui/button";

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
    { href: "http://localhost:3003/dashboard", label: "Long Line Diary" },
    { href: "http://localhost:3002/dashboard", label: "Tool Tracker" },
    { href: "http://localhost:3004/login", label: "FitoutOS" },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAFA]" data-testid="app-layout">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex items-center">
              <Link to="/" className="flex items-center" data-testid="logo-link">
                <span className="text-lg font-bold text-gray-900">Timesheet</span>
                <span className="ml-1 text-xs bg-gray-900 text-white px-2 py-0.5 rounded uppercase">
                  {user?.role?.replace("_", " ")}
                </span>
              </Link>
              
              {/* Desktop Navigation */}
              <div className="hidden md:flex ml-8 space-x-1">
                {roleNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                      isActive(item.path)
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                    data-testid={`nav-${item.path.replace(/\//g, "-")}`}
                  >
                    {item.label}
                  </Link>
                ))}

                <div className="mx-2 h-6 border-l border-gray-200" aria-hidden="true" />

                {suiteLinks.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="px-3 py-2 text-sm font-medium rounded transition-colors text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                    data-testid={`suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 hidden sm:block" data-testid="user-name">
                {user?.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                data-testid="logout-button"
              >
                <LogOut className="w-4 h-4" />
                <span className="ml-2 hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden border-t border-gray-200 overflow-x-auto">
          <div className="flex px-2 py-2 space-x-1">
            {roleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center px-3 py-2 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                    isActive(item.path)
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Icon className="w-4 h-4 mr-1" />
                  {item.label}
                </Link>
              );
            })}

            {suiteLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center px-3 py-2 text-xs font-medium rounded whitespace-nowrap transition-colors text-gray-500 hover:text-gray-900"
                data-testid={`mobile-suite-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
