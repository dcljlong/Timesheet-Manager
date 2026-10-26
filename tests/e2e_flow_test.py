"""End-to-end API flow test for Timesheet Manager.

Runs the real FastAPI app against an in-memory MongoDB (mongomock-motor), so it
needs no database server. Walks one timesheet from employee submit through PM
and admin approval, checks the exports, and checks the Smartly export switch.

Run from the repo root:
    pip install -r backend/requirements.txt mongomock-motor httpx pytest
    python -m pytest tests/e2e_flow_test.py -v
"""
import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
ADMIN = ("admin@example.co.nz", "AdminPass123!")
PM = ("pm@example.co.nz", "PmPass123!")
EMP = ("emp@example.co.nz", "EmpPass123!")


def load_app(smartly_enabled: bool):
    import mongomock_motor
    import motor.motor_asyncio

    motor.motor_asyncio.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
    os.environ.update(
        MONGO_URL="mongodb://localhost:27017",
        DB_NAME="tm_e2e",
        JWT_SECRET="e2e-secret",
        ADMIN_EMAIL=ADMIN[0],
        ADMIN_PASSWORD=ADMIN[1],
        ADMIN_NAME="Test Admin",
        SMARTLY_EXPORT_ENABLED="true" if smartly_enabled else "false",
    )
    backend = str(Path(__file__).resolve().parents[1] / "backend")
    if backend not in sys.path:
        sys.path.insert(0, backend)
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server").app


def login(client, creds):
    r = client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    body = r.json()
    token = body.get("access_token") or body.get("token") or client.cookies.get("access_token")
    client.cookies.clear()
    assert token, f"no token in login response: {body}"
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def flow():
    app = load_app(smartly_enabled=False)
    with TestClient(app) as client:
        admin = login(client, ADMIN)

        # Admin sets up a PM, a job and an employee
        for email, pw, name, role in [(PM[0], PM[1], "Pat PM", "project_manager"),
                                      (EMP[0], EMP[1], "Eddie Employee", "employee")]:
            r = client.post("/api/users", headers=admin,
                            json={"email": email, "password": pw, "name": name, "role": role})
            assert r.status_code in (200, 201), r.text
        r = client.post("/api/project-managers", headers=admin,
                        json={"initials": "PP", "name": "Pat PM", "email": PM[0]})
        assert r.status_code in (200, 201), r.text
        pm_id = r.json()["id"]
        r = client.post("/api/job-numbers", headers=admin,
                        json={"job_number": "4177", "description": "Craigs Fitout"})
        assert r.status_code in (200, 201), r.text

        codes = client.get("/api/task-codes", headers=admin)
        assert codes.status_code == 200, codes.text
        if codes.json():
            task_code = codes.json()[0]["code"]
        else:
            r = client.post("/api/task-codes", headers=admin, json={"code": "FRM", "description": "Framing"})
            assert r.status_code in (200, 201), r.text
            task_code = "FRM"

        yield {"client": client, "admin": admin, "pm_id": pm_id, "task_code": task_code}


def make_timesheet(pm_id, task_code):
    day = lambda name: {"day": name, "entries": [{
        "type": "work", "start_time": "07:00", "lunch_duration": "30", "finish_time": "15:30",
        "total_hours": 8.0, "job_number": "4177", "task_code": task_code,
        "project_manager_id": pm_id, "description": "Level 6 framing"}]}
    return {"week_ending": "2026-11-01", "period_type": "weekly", "employee_name": "Eddie Employee",
            "days": [day(d) for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]],
            "total_hours": 40.0, "employee_signature": SIG, "nights_away": 0}


def test_full_approval_flow(flow):
    c, admin = flow["client"], flow["admin"]

    emp = login(c, EMP)
    r = c.post("/api/timesheets", headers=emp, json=make_timesheet(flow["pm_id"], flow["task_code"]))
    assert r.status_code == 200, r.text
    ts_id = r.json()["id"]

    # Employee sees it in their list
    r = c.get("/api/timesheets", headers=emp)
    assert r.status_code == 200 and any(t["id"] == ts_id for t in r.json()), r.text

    # Employee can't approve their own timesheet
    r = c.post(f"/api/timesheets/{ts_id}/pm-approve", headers=emp,
               json={"action": "approve", "signature": SIG})
    assert r.status_code == 403, r.text

    # Admin can't final-approve before the PM has signed
    r = c.post(f"/api/timesheets/{ts_id}/admin-approve", headers=admin, json={"action": "approve"})
    assert r.status_code == 400, r.text

    # PM sees it and approves
    pm = login(c, PM)
    r = c.get("/api/timesheets", headers=pm)
    assert r.status_code == 200 and any(t["id"] == ts_id for t in r.json()), r.text
    r = c.post(f"/api/timesheets/{ts_id}/pm-approve", headers=pm,
               json={"action": "approve", "signature": SIG})
    assert r.status_code == 200, r.text
    assert c.get(f"/api/timesheets/{ts_id}", headers=pm).json()["status"] == "pm_approved"

    # Admin final approval
    r = c.post(f"/api/timesheets/{ts_id}/admin-approve", headers=admin, json={"action": "approve"})
    assert r.status_code == 200, r.text
    ts = c.get(f"/api/timesheets/{ts_id}", headers=admin).json()
    assert ts["status"] == "approved", ts["status"]
    assert ts["total_hours"] == 40.0

    # Payroll review CSV (what admin/Lisa uses) downloads with a clean filename
    r = c.get("/api/timesheets/export.csv", headers=admin)
    assert r.status_code == 200, r.text
    cd = r.headers["content-disposition"]
    assert cd.startswith('attachment; filename="') and '""' not in cd, cd
    assert "Eddie Employee" in r.text and "4177" in r.text

    # Employee can't download the payroll export
    r = c.get("/api/timesheets/export.csv", headers=emp)
    assert r.status_code == 403, r.text


def test_reject_and_resubmit(flow):
    c, admin = flow["client"], flow["admin"]
    emp = login(c, EMP)
    body = make_timesheet(flow["pm_id"], flow["task_code"])
    body["week_ending"] = "2026-11-08"
    ts_id = c.post("/api/timesheets", headers=emp, json=body).json()["id"]

    pm = login(c, PM)
    r = c.post(f"/api/timesheets/{ts_id}/pm-approve", headers=pm,
               json={"action": "reject", "comment": "Wrong job on Friday"})
    assert r.status_code == 200, r.text
    ts = c.get(f"/api/timesheets/{ts_id}", headers=emp).json()
    assert ts["status"] == "rejected", ts["status"]

    body["days"][4]["entries"][0]["description"] = "Fixed"
    r = c.put(f"/api/timesheets/{ts_id}", headers=emp,
              json={"days": body["days"], "total_hours": 40.0})
    assert r.status_code == 200, r.text


def test_smartly_hidden_when_switched_off(flow):
    c, admin = flow["client"], flow["admin"]
    assert c.get("/api/features").json() == {"smartly_export": False}
    for path in ["/api/timesheets/smartly-export-summary", "/api/timesheets/smartly-export.csv"]:
        r = c.get(path, headers=admin)
        assert r.status_code == 404 and "switched off" in r.text, (path, r.status_code, r.text)


def test_smartly_available_when_switched_on():
    app = load_app(smartly_enabled=True)
    with TestClient(app) as c:
        admin = login(c, ADMIN)
        assert c.get("/api/features").json() == {"smartly_export": True}
        r = c.get("/api/timesheets/smartly-export-summary", headers=admin)
        assert r.status_code == 200, r.text
        r = c.get("/api/timesheets/smartly-export.csv", headers=admin)
        assert r.status_code == 200, r.text
        cd = r.headers["content-disposition"]
        assert '""' not in cd, cd
    load_app(smartly_enabled=False)
