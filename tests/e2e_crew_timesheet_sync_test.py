"""End-to-end tests: Crew Register entries feed each person's weekly timesheet.

Real FastAPI app on an in-memory MongoDB. Run from the repo root:
    python -m pytest tests/e2e_crew_timesheet_sync_test.py -v
"""
import pytest
from fastapi.testclient import TestClient

from tests.e2e_flow_test import ADMIN, EMP, PM, SIG, load_app, login

MON, TUE, WED = "2026-10-26", "2026-10-27", "2026-10-28"
WEEK = "2026-11-01"  # Sunday week ending


@pytest.fixture(scope="module")
def env():
    app = load_app(smartly_enabled=False)
    with TestClient(app) as c:
        admin = login(c, ADMIN)
        ids = {}
        for email, pw, name, role in [
            (PM[0], PM[1], "Davy PM", "project_manager"),
            (EMP[0], EMP[1], "Eddie Employee", "employee"),
            ("sam@example.co.nz", "SamPass123!", "Sam Hammer", "employee"),
            ("own@example.co.nz", "OwnPass123!", "Olly Own", "employee"),
        ]:
            r = c.post("/api/users", headers=admin, json={"email": email, "password": pw, "name": name, "role": role})
            assert r.status_code in (200, 201), r.text
            ids[name] = r.json()["id"]
        for job in ["4177", "4009"]:
            assert c.post("/api/job-numbers", headers=admin, json={"job_number": job, "description": ""}).status_code in (200, 201)
        pm = c.post("/api/project-managers", headers=admin, json={"initials": "DL", "name": "Davy PM", "email": PM[0]}).json()
        codes = c.get("/api/task-codes", headers=admin).json()
        if not codes:
            c.post("/api/task-codes", headers=admin, json={"code": "FRM", "description": "Framing"})
            codes = c.get("/api/task-codes", headers=admin).json()
        yield {"c": c, "admin": admin, "ids": ids, "pm_id": pm["id"], "task": codes[0]["code"]}


def member(ids, name, start="07:00", finish="15:30", lunch=30, **extra):
    return {"user_id": ids[name], "name": name, "start_time": start, "finish_time": finish, "lunch_minutes": lunch, **extra}


def save(env, work_date, crew, job="4177", **extra):
    pm = login(env["c"], PM)
    body = {"work_date": work_date, "job_number": job, "task_code": env["task"], "project_manager_id": env["pm_id"],
            "crew": crew, "subbies": [], **extra}
    r = env["c"].post("/api/crew-register", headers=pm, json=body)
    return r


def sheet(env, name):
    rows = env["c"].get("/api/crew-register/week", headers=login(env["c"], PM), params={"work_date": MON}).json()["timesheets"]
    row = next((t for t in rows if t["employee_name"] == name), None)
    if not row:
        return None
    return env["c"].get(f"/api/timesheets/{row['id']}", headers=env["admin"]).json()


def day_entries(ts, day):
    return next(d for d in ts["days"] if d["day"] == day)["entries"]


def test_task_code_and_pm_required_for_staff(env):
    pm = login(env["c"], PM)
    body = {"work_date": MON, "job_number": "4177", "crew": [member(env["ids"], "Eddie Employee")], "subbies": []}
    r = env["c"].post("/api/crew-register", headers=pm, json=body)
    assert r.status_code == 400 and "task code" in r.text
    body["task_code"] = env["task"]
    r = env["c"].post("/api/crew-register", headers=pm, json=body)
    assert r.status_code == 400 and "project manager" in r.text
    # Subbies-only day needs neither
    r = env["c"].post("/api/crew-register", headers=pm, json={"work_date": "2026-10-20", "job_number": "4177", "crew": [], "subbies": [{"company": "X", "count": 1}]})
    assert r.status_code == 200, r.text


def test_monday_creates_draft_timesheets(env):
    ids = env["ids"]
    r = save(env, MON, [member(ids, "Eddie Employee"), member(ids, "Sam Hammer", finish="12:00", lunch=0, note="dentist"),
                        {"name": "Labour hire", "start_time": "07:00", "finish_time": "15:30", "lunch_minutes": 30}])
    assert r.status_code == 200, r.text
    sync = {s["name"]: s for s in r.json()["timesheet_sync"]}
    assert sync["Eddie Employee"]["result"] == "created"
    assert sync["Sam Hammer"]["result"] == "created"
    assert sync["Labour hire"]["result"] == "skipped"

    eddie = sheet(env, "Eddie Employee")
    assert eddie["status"] == "draft" and eddie["week_ending"] == WEEK and eddie["total_hours"] == 8.0
    e = day_entries(eddie, "Monday")[0]
    assert (e["start_time"], e["finish_time"], e["lunch_duration"], e["job_number"], e["task_code"], e["project_manager_id"]) == \
        ("07:00", "15:30", "30", "4177", env["task"], env["pm_id"])
    sam = sheet(env, "Sam Hammer")
    assert sam["total_hours"] == 5.0 and day_entries(sam, "Monday")[0]["description"] == "dentist"

    # Drafts don't show as pending approval yet
    assert env["c"].get("/api/dashboard/stats", headers=env["admin"]).json()["pending_pm_approval"] == 0


def test_more_days_and_second_job_add_to_same_week(env):
    ids = env["ids"]
    assert save(env, TUE, [member(ids, "Eddie Employee")]).status_code == 200
    # Same day, another job: Eddie does an extra 2 hours on 4009
    assert save(env, TUE, [member(ids, "Eddie Employee", start="16:00", finish="18:00", lunch=0)], job="4009").status_code == 200
    eddie = sheet(env, "Eddie Employee")
    assert eddie["total_hours"] == 18.0
    tue = day_entries(eddie, "Tuesday")
    assert sorted(e["job_number"] for e in tue) == ["4009", "4177"]


def test_resave_replaces_not_duplicates_and_removal_cleans_up(env):
    ids = env["ids"]
    # Re-save Monday with Eddie finishing later and Sam taken off
    r = save(env, MON, [member(ids, "Eddie Employee", finish="16:30")])
    assert r.status_code == 200
    eddie = sheet(env, "Eddie Employee")
    assert len(day_entries(eddie, "Monday")) == 1
    assert eddie["total_hours"] == 19.0  # 9 + 8 + 2
    assert sheet(env, "Sam Hammer") is None  # Sam only had Monday, so his draft is removed
    assert {s["name"]: s["result"] for s in r.json()["timesheet_sync"]}["Sam Hammer"] == "removed"


def test_own_timesheet_is_left_alone_and_cannot_double_up(env):
    c, ids = env["c"], env["ids"]
    own = login(c, ("own@example.co.nz", "OwnPass123!"))
    body = {"week_ending": WEEK, "period_type": "weekly", "employee_name": "Olly Own", "total_hours": 8, "employee_signature": SIG,
            "days": [{"day": "Monday", "entries": [{"type": "work", "start_time": "07:00", "lunch_duration": "30", "finish_time": "15:30",
                                                     "total_hours": 8, "job_number": "4177", "task_code": env["task"],
                                                     "project_manager_id": env["pm_id"]}]}]}
    assert c.post("/api/timesheets", headers=own, json=body).status_code == 200
    r = save(env, WED, [member(ids, "Olly Own"), member(ids, "Eddie Employee")])
    sync = {s["name"]: s for s in r.json()["timesheet_sync"]}
    assert sync["Olly Own"]["result"] == "skipped" and "own timesheet" in sync["Olly Own"]["reason"]
    assert sync["Eddie Employee"]["result"] == "updated"

    # Eddie can't start his own timesheet for a crew-entered week
    emp = login(c, EMP)
    body["employee_name"] = "Eddie Employee"
    r = c.post("/api/timesheets", headers=emp, json=body)
    assert r.status_code == 400 and "Crew Register" in r.text


def test_send_week_then_pm_and_admin_approve(env):
    c, ids = env["c"], env["ids"]
    pm = login(c, PM)
    r = c.post("/api/crew-register/week/submit", headers=pm, json={"week_ending": WEEK})
    assert r.status_code == 200 and r.json()["submitted"] == 1  # Eddie
    eddie = sheet(env, "Eddie Employee")
    assert eddie["status"] == "submitted"
    assert c.get("/api/dashboard/stats", headers=env["admin"]).json()["pending_pm_approval"] == 2  # Eddie (crew) + Olly (own)

    r = c.post(f"/api/timesheets/{eddie['id']}/pm-approve", headers=pm, json={"action": "approve", "signature": SIG})
    assert r.status_code == 200, r.text
    r = c.post(f"/api/timesheets/{eddie['id']}/admin-approve", headers=env["admin"], json={"action": "approve"})
    assert r.status_code == 200, r.text
    assert sheet(env, "Eddie Employee")["status"] == "approved"

    # Approved timesheets aren't changed by later register edits
    r = save(env, WED, [member(ids, "Eddie Employee", finish="17:00")])
    sync = {s["name"]: s for s in r.json()["timesheet_sync"]}
    assert sync["Eddie Employee"]["result"] == "skipped" and "approved" in sync["Eddie Employee"]["reason"]
    assert sheet(env, "Eddie Employee")["total_hours"] == 27.0

    # Approved crew hours appear in the payroll review CSV
    csv = c.get("/api/timesheets/export.csv", headers=env["admin"]).text
    assert "Eddie Employee" in csv


def test_deleting_a_day_removes_its_hours(env):
    c, ids = env["c"], env["ids"]
    nxt = "2026-11-02"
    r = save(env, nxt, [member(ids, "Sam Hammer")])
    day_id = r.json()["id"]
    rows = c.get("/api/crew-register/week", headers=login(c, PM), params={"work_date": nxt}).json()["timesheets"]
    assert [t["employee_name"] for t in rows] == ["Sam Hammer"]
    r = c.delete(f"/api/crew-register/{day_id}", headers=login(c, PM))
    assert r.status_code == 200
    rows = c.get("/api/crew-register/week", headers=login(c, PM), params={"work_date": nxt}).json()["timesheets"]
    assert rows == []


def test_pm_edit_keeps_link_to_register_day(env):
    c, ids = env["c"], env["ids"]
    nxt = "2026-11-03"
    assert save(env, nxt, [member(ids, "Sam Hammer")]).status_code == 200
    rows = c.get("/api/crew-register/week", headers=login(c, PM), params={"work_date": nxt}).json()["timesheets"]
    ts = c.get(f"/api/timesheets/{rows[0]['id']}", headers=env["admin"]).json()
    c.post("/api/crew-register/week/submit", headers=login(c, PM), json={"week_ending": ts["week_ending"]})
    # PM edits the timesheet (e.g. tweaks the note) and saves
    days = ts["days"]
    days[1]["entries"][0]["description"] = "checked"
    r = c.put(f"/api/timesheets/{ts['id']}", headers=login(c, PM), json={"days": days, "total_hours": ts["total_hours"], "pm_edit_reason": "note"})
    assert r.status_code == 200, r.text
    # Register re-save replaces the entry rather than adding a second one
    assert save(env, nxt, [member(ids, "Sam Hammer", finish="16:30")]).status_code == 200
    ts = c.get(f"/api/timesheets/{rows[0]['id']}", headers=env["admin"]).json()
    assert len(ts["days"][1]["entries"]) == 1 and ts["total_hours"] == 9.0
