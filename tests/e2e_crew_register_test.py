"""End-to-end API tests for the Crew Register (foreman daily register).

Same setup as e2e_flow_test.py: the real FastAPI app on an in-memory MongoDB.
Run from the repo root:
    python -m pytest tests/e2e_crew_register_test.py -v
"""
import pytest
from fastapi.testclient import TestClient

from tests.e2e_flow_test import ADMIN, EMP, PM, load_app, login


@pytest.fixture(scope="module")
def setup():
    app = load_app(smartly_enabled=False)
    with TestClient(app) as client:
        admin = login(client, ADMIN)
        ids = {}
        for email, pw, name, role in [
            (PM[0], PM[1], "Jayden Foreman", "project_manager"),
            (EMP[0], EMP[1], "Eddie Employee", "employee"),
            ("sam@example.co.nz", "SamPass123!", "Sam Hammer", "employee"),
        ]:
            r = client.post("/api/users", headers=admin, json={"email": email, "password": pw, "name": name, "role": role})
            assert r.status_code in (200, 201), r.text
            ids[name] = r.json()["id"]
        for job, desc in [("4177", "Craigs Fitout"), ("4009", "2 Devonport")]:
            r = client.post("/api/job-numbers", headers=admin, json={"job_number": job, "description": desc})
            assert r.status_code in (200, 201), r.text
        r = client.post("/api/project-managers", headers=admin, json={"initials": "JF", "name": "Jayden Foreman", "email": PM[0]})
        assert r.status_code in (200, 201), r.text
        ids["_pm"] = r.json()["id"]
        codes = client.get("/api/task-codes", headers=admin).json()
        if not codes:
            client.post("/api/task-codes", headers=admin, json={"code": "FRM", "description": "Framing"})
            codes = client.get("/api/task-codes", headers=admin).json()
        ids["_task"] = codes[0]["code"]
        yield {"client": client, "admin": admin, "ids": ids}


def day_body(ids):
    return {
        "work_date": "2026-10-26",
        "job_number": "4177",
        "task_code": ids["_task"],
        "project_manager_id": ids["_pm"],
        "crew": [
            {"user_id": ids["Eddie Employee"], "name": "Eddie Employee", "start_time": "07:00", "finish_time": "15:30", "lunch_minutes": 30},
            {"user_id": ids["Sam Hammer"], "name": "Sam Hammer", "start_time": "07:00", "finish_time": "12:00", "lunch_minutes": 0,
             "note": "left at 12 for dentist"},
            {"name": "Labour hire guy", "start_time": "07:00", "finish_time": "15:30", "lunch_minutes": 30, "job_number": "4009"},
        ],
        "subbies": [{"company": "Beejays", "count": 4, "note": "carpet L5"}, {"company": "Sparky Co", "count": 2}],
        "notes": "Scissor lift on hire",
    }


def test_employee_cannot_use_register(setup):
    c = setup["client"]
    emp = login(c, EMP)
    assert c.get("/api/crew-register/staff", headers=emp).status_code == 403
    assert c.post("/api/crew-register", headers=emp, json=day_body(setup["ids"])).status_code == 403


def test_save_day_and_messages(setup):
    c, ids = setup["client"], setup["ids"]
    pm = login(c, PM)

    staff = c.get("/api/crew-register/staff", headers=pm)
    assert staff.status_code == 200
    names = [s["name"] for s in staff.json()]
    assert "Eddie Employee" in names and "Sam Hammer" in names
    assert all("email" not in s for s in staff.json())

    r = c.post("/api/crew-register", headers=pm, json=day_body(ids))
    assert r.status_code == 200, r.text
    day = r.json()
    assert day["westaco_count"] == 3
    assert day["subbie_count"] == 6
    assert day["total_on_site"] == 9
    hours = {m["name"]: m["hours"] for m in day["crew"]}
    assert hours == {"Eddie Employee": 8.0, "Sam Hammer": 5.0, "Labour hire guy": 8.0}
    assert day["total_hours"] == 21.0

    basic = c.get(f"/api/crew-register/{day['id']}/message", headers=pm, params={"level": "basic"}).json()["text"]
    assert basic.splitlines() == [
        "4177 Craigs Fitout – Mon 26 Oct 2026",
        "On site: 9",
        "Westaco: 3",
        "Beejays: 4",
        "Sparky Co: 2",
    ]

    full = c.get(f"/api/crew-register/{day['id']}/message", headers=pm, params={"level": "full"}).json()["text"]
    assert "Westaco crew (21 hrs):" in full
    assert "- Eddie Employee 7:00–15:30 (8h)" in full
    assert "- Sam Hammer 7:00–12:00 (5h) – left at 12 for dentist" in full
    assert "- Labour hire guy 7:00–15:30 (8h) – job 4009" in full
    assert "- Beejays (4): carpet L5" in full
    assert "Notes: Scissor lift on hire" in full

    assert c.get(f"/api/crew-register/{day['id']}/message", headers=pm, params={"level": "huge"}).status_code == 400


def test_resave_updates_same_day(setup):
    c, ids = setup["client"], setup["ids"]
    pm = login(c, PM)
    body = day_body(ids)
    body["subbies"] = [{"company": "Beejays", "count": 3}]
    r = c.post("/api/crew-register", headers=pm, json=body)
    assert r.status_code == 200, r.text
    listed = c.get("/api/crew-register", headers=pm, params={"work_date": "2026-10-26", "job_number": "4177"}).json()
    assert len(listed) == 1, listed
    assert listed[0]["total_on_site"] == 6

    # A different job on the same day is its own register
    body["job_number"] = "4009"
    assert c.post("/api/crew-register", headers=pm, json=body).status_code == 200
    assert len(c.get("/api/crew-register", headers=pm, params={"work_date": "2026-10-26"}).json()) == 2


def test_bad_input_is_rejected(setup):
    c, ids = setup["client"], setup["ids"]
    pm = login(c, PM)
    body = day_body(ids)
    body["crew"][0]["finish_time"] = "06:00"
    r = c.post("/api/crew-register", headers=pm, json=body)
    assert r.status_code == 400 and "Finish time" in r.text

    body = day_body(ids)
    body["crew"].append(dict(body["crew"][0]))
    r = c.post("/api/crew-register", headers=pm, json=body)
    assert r.status_code == 400 and "listed twice" in r.text

    body = day_body(ids)
    body["job_number"] = " "
    assert c.post("/api/crew-register", headers=pm, json=body).status_code == 400


def test_week_export_csv(setup):
    c, ids = setup["client"], setup["ids"]
    pm = login(c, PM)
    body = day_body(ids)
    body["work_date"] = "2026-10-27"
    assert c.post("/api/crew-register", headers=pm, json=body).status_code == 200

    r = c.get("/api/crew-register/export.csv", headers=pm,
              params={"date_from": "2026-10-26", "date_to": "2026-11-01", "job_number": "4177"})
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"] == 'attachment; filename="crew_register_4177_2026-10-26_2026-11-01.csv"'
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("Date,Job,Type,Name / Company")
    assert any(l.startswith("2026-10-27,4177,Westaco,Eddie Employee,07:00,15:30,30,8.0") for l in lines), lines
    assert any(l.startswith("2026-10-27,4009,Westaco,Labour hire guy") for l in lines), lines
    assert any(",Subbie,Beejays," in l for l in lines), lines


def test_delete_day(setup):
    c = setup["client"]
    pm = login(c, PM)
    day = c.get("/api/crew-register", headers=pm, params={"work_date": "2026-10-27", "job_number": "4177"}).json()[0]
    assert c.delete(f"/api/crew-register/{day['id']}", headers=pm).status_code == 200
    assert c.get(f"/api/crew-register/{day['id']}", headers=pm).status_code == 404


def test_cors_allows_own_vercel_previews_only(setup):
    c = setup["client"]
    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization"}
    ok = c.options("/api/auth/login", headers={"Origin": "https://timesheet-manager-7lyb79cy4-dcljlongs-projects.vercel.app", **preflight})
    assert ok.headers.get("access-control-allow-origin") == "https://timesheet-manager-7lyb79cy4-dcljlongs-projects.vercel.app"
    bad = c.options("/api/auth/login", headers={"Origin": "https://timesheet-manager-evil.vercel.app", **preflight})
    assert bad.headers.get("access-control-allow-origin") is None
