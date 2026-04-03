# Timesheet Management App PRD

## Original Problem Statement
A company timesheet app with weekly/fortnightly timesheets. Features include: multiple jobs per day, week ending date, save defaults from last entry, dropdown with task codes + ability to add new codes, lunch time selection (30 min or 1 hr), running totals and total at bottom.

## User Choices
- 3 roles: Employee, Project Manager, Admin
- 2-step approval: Employee → PM → Admin
- Job numbers with PM initials for assignment
- Admin dashboard showing all submitted timesheets
- PM signature boxes when approving (can have multiple PMs)
- Employee signature when submitting
- In-app audible notifications for submission reminders

## User Personas
1. **Employee**: Submits timesheets, signs electronically, views own history
2. **Project Manager**: Reviews assigned timesheets, signs to approve
3. **Admin**: Full access to all timesheets, manages users/codes/PMs, final approval

## Core Requirements (Static)
- Weekly or fortnightly timesheet periods
- Multiple jobs per day with time entries
- Task codes dropdown (pre-loaded from template) + add new
- Lunch time selection (30 min / 1 hr)
- Running totals per day + weekly total
- Week ending date (Sunday)
- Employee signature canvas for submission
- PM signature canvas for approval
- PDF/Print export

## What's Been Implemented (April 3, 2026)
- [x] JWT-based authentication with 3 roles
- [x] Admin seeding on startup
- [x] All 22 task codes pre-loaded from template
- [x] Timesheet creation with full grid (Mon-Sun)
- [x] Time entry with start/lunch/finish/hours calculation
- [x] Task code dropdown with "Add New" option
- [x] PM selection dropdown
- [x] Running totals and weekly total
- [x] Employee signature pad
- [x] PM signature pad for approval
- [x] 2-step approval workflow
- [x] Admin dashboard with all timesheets
- [x] PM dashboard with pending approvals
- [x] Employee dashboard with own timesheets
- [x] Task codes management (CRUD)
- [x] Project Managers management (CRUD)
- [x] Users management (roles, delete)
- [x] Notification settings page
- [x] Print/PDF export functionality

## P0 Features (MVP - Complete)
- ✅ User authentication & roles
- ✅ Timesheet entry form
- ✅ Hours calculation
- ✅ Signature pads
- ✅ Approval workflow

## P1 Features (Next Phase)
- [ ] Save defaults from last entry (backend done, frontend needs implementation)
- [ ] Email notifications for submission reminders
- [ ] Fortnightly period view (2 weeks in one form)
- [ ] Bulk copy previous week
- [ ] Holiday/leave calendar integration

## P2 Features (Future)
- [ ] Dashboard analytics & reporting
- [ ] Overtime alerts
- [ ] Audit trail for edits
- [ ] Mobile app version
- [ ] Export to payroll systems (CSV)

## Test Credentials
- Admin: admin@timesheet.com / admin123

## Tech Stack
- Backend: FastAPI + MongoDB
- Frontend: React + Tailwind CSS + Shadcn UI
- Auth: JWT with httpOnly cookies
