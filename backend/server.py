from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import bcrypt
import jwt
import json
import urllib.request
import secrets
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from fastapi.responses import StreamingResponse
import csv
import io
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"

# Create the main app
app = FastAPI(title="Timesheet App")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "employee"  # employee, project_manager, admin

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    created_at: str

class TaskCodeCreate(BaseModel):
    code: str
    description: str
    smartly_department_quick_code: Optional[str] = ""
    smartly_export_enabled: bool = True

class TaskCodeResponse(BaseModel):
    id: str
    code: str
    description: str
    smartly_department_quick_code: str = ""
    smartly_export_enabled: bool = True

class ProjectManagerCreate(BaseModel):
    initials: str
    name: str
    email: Optional[str] = None

class ProjectManagerResponse(BaseModel):
    id: str
    initials: str
    name: str
    email: Optional[str] = None

class TimeEntry(BaseModel):
    start_time: Optional[str] = None
    lunch_duration: Optional[str] = None  # "30" or "60" minutes
    finish_time: Optional[str] = None
    total_hours: Optional[float] = None
    pm_edit_reason: Optional[str] = None
    pm_edit_reason: Optional[str] = None
    job_number: Optional[str] = None
    task_code: Optional[str] = None
    project_manager_id: Optional[str] = None
    description: Optional[str] = None
    other: Optional[str] = None

class DayEntry(BaseModel):
    day: str  # Monday, Tuesday, etc.
    entries: List[TimeEntry] = []

class SignatureData(BaseModel):
    pm_id: str
    pm_name: str
    signature: str  # Base64 encoded signature image
    signed_at: str

class TimesheetCreate(BaseModel):
    week_ending: str  # ISO date string
    period_type: str = "weekly"  # weekly or fortnightly
    employee_name: str
    days: List[DayEntry]
    messages: Optional[str] = None
    nights_away: Optional[int] = 0
    total_hours: float = 0
    employee_signature: Optional[str] = None  # Base64 encoded signature

class TimesheetUpdate(BaseModel):
    week_ending: Optional[str] = None
    period_type: Optional[str] = None
    days: Optional[List[DayEntry]] = None
    messages: Optional[str] = None
    nights_away: Optional[int] = None
    total_hours: Optional[float] = None
    pm_edit_reason: Optional[str] = None

class TimesheetApproval(BaseModel):
    action: str  # "approve" or "reject"
    comment: Optional[str] = None
    signature: Optional[str] = None  # Base64 encoded PM signature

class NotificationSettingsUpdate(BaseModel):
    reminder_time: str  # HH:MM format
    reminder_day: str  # Day of week for submission reminder
    enabled: bool = True

# ==================== HELPER FUNCTIONS ====================

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def get_jwt_secret() -> str:
    return JWT_SECRET

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        "type": "access"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "created_at": user.get("created_at", datetime.now(timezone.utc)).isoformat() if isinstance(user.get("created_at"), datetime) else str(user.get("created_at", ""))
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def serialize_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "created_at": user.get("created_at", datetime.now(timezone.utc)).isoformat() if isinstance(user.get("created_at"), datetime) else str(user.get("created_at", ""))
    }

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register(user: UserCreate, response: Response):
    email = user.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed = hash_password(user.password)
    user_doc = {
        "email": email,
        "password_hash": hashed,
        "name": user.name,
        "role": user.role if user.role in ["employee", "project_manager"] else "employee",
        "created_at": datetime.now(timezone.utc),
        "notification_settings": {
            "reminder_time": "17:00",
            "reminder_day": "Friday",
            "enabled": True
        }
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    
    
    return {
        "id": user_id,
        "email": email,
        "name": user.name,
        "role": user_doc["role"],
        "created_at": user_doc["created_at"].isoformat()
    }

@api_router.post("/auth/login")
async def login(user: UserLogin, response: Response, request: Request):
    email = user.email.lower()

    # Check brute force
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempts = await db.login_attempts.find_one({"identifier": identifier})

    if attempts and attempts.get("count", 0) >= 5:
        lockout_time = attempts.get("locked_until")
        if lockout_time and datetime.now(timezone.utc) < lockout_time:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})

    db_user = await db.users.find_one({"email": email})
    if not db_user:
        await increment_login_attempts(identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not db_user.get("password_hash") or not verify_password(user.password, db_user["password_hash"]):
        await increment_login_attempts(identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Clear failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})

    user_id = str(db_user["_id"])
    access_token = create_access_token(user_id, email, db_user["role"])

    user_data = serialize_user(db_user)
    user_data["access_token"] = access_token
    return user_data
async def increment_login_attempts(identifier: str):
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {
            "$inc": {"count": 1},
            "$set": {"locked_until": datetime.now(timezone.utc) + timedelta(minutes=15)}
        },
        upsert=True
    )

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        access_token = create_access_token(str(user["_id"]), user["email"], user["role"])
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
        return serialize_user(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# ==================== TASK CODES ENDPOINTS ====================

@api_router.get("/task-codes", response_model=List[TaskCodeResponse])
async def get_task_codes():
    codes = await db.task_codes.find({}, {"_id": 1, "code": 1, "description": 1, "smartly_department_quick_code": 1, "smartly_export_enabled": 1}).to_list(1000)
    return [{"id": str(c["_id"]), "code": c["code"], "description": c["description"], "smartly_department_quick_code": c.get("smartly_department_quick_code", ""), "smartly_export_enabled": c.get("smartly_export_enabled", True)} for c in codes]

@api_router.post("/task-codes", response_model=TaskCodeResponse)
async def create_task_code(task_code: TaskCodeCreate, request: Request):
    user = await get_current_user(request)
    existing = await db.task_codes.find_one({"code": task_code.code})
    if existing:
        raise HTTPException(status_code=400, detail="Task code already exists")
    
    doc = {"code": task_code.code, "description": task_code.description, "smartly_department_quick_code": (task_code.smartly_department_quick_code or "").strip(), "smartly_export_enabled": bool(task_code.smartly_export_enabled), "created_by": user["id"], "created_at": datetime.now(timezone.utc)}
    result = await db.task_codes.insert_one(doc)
    return {"id": str(result.inserted_id), "code": task_code.code, "description": task_code.description, "smartly_department_quick_code": (task_code.smartly_department_quick_code or "").strip(), "smartly_export_enabled": bool(task_code.smartly_export_enabled)}


@api_router.put("/task-codes/{code_id}/smartly-settings")
async def update_task_code_smartly_settings(code_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    body = await request.json()
    smartly_department_quick_code = (body.get("smartly_department_quick_code") or "").strip()
    smartly_export_enabled = body.get("smartly_export_enabled")

    if smartly_export_enabled is None:
        smartly_export_enabled = True
    else:
        smartly_export_enabled = bool(smartly_export_enabled)

    result = await db.task_codes.update_one(
        {"_id": ObjectId(code_id)},
        {"$set": {
            "smartly_department_quick_code": smartly_department_quick_code,
            "smartly_export_enabled": smartly_export_enabled
        }}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task code not found")

    return {"message": "Task code Smartly settings updated"}

@api_router.delete("/task-codes/{code_id}")
async def delete_task_code(code_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.task_codes.delete_one({"_id": ObjectId(code_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task code not found")
    return {"message": "Task code deleted"}

# ==================== PROJECT MANAGERS ENDPOINTS ====================

@api_router.get("/project-managers", response_model=List[ProjectManagerResponse])
async def get_project_managers():
    pms = await db.project_managers.find({}, {"_id": 1, "initials": 1, "name": 1, "email": 1}).to_list(1000)
    return [{"id": str(pm["_id"]), "initials": pm["initials"], "name": pm["name"], "email": pm.get("email")} for pm in pms]

@api_router.post("/project-managers", response_model=ProjectManagerResponse)
async def create_project_manager(pm: ProjectManagerCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    existing = await db.project_managers.find_one({"initials": pm.initials.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="PM initials already exist")
    
    doc = {"initials": pm.initials.upper(), "name": pm.name, "email": pm.email, "created_at": datetime.now(timezone.utc)}
    result = await db.project_managers.insert_one(doc)
    return {"id": str(result.inserted_id), "initials": pm.initials.upper(), "name": pm.name, "email": pm.email}

@api_router.delete("/project-managers/{pm_id}")
async def delete_project_manager(pm_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.project_managers.delete_one({"_id": ObjectId(pm_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project Manager not found")
    return {"message": "Project Manager deleted"}

LEAVE_ENTRY_TYPES = {"public_holiday", "annual_leave", "sick"}

def _normalise_entry_type(value):
    return str(value or "work").strip().lower().replace(" ", "_")

def _has_entry_value(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True

def validate_timesheet_entries(days, require_signature=False, employee_signature=None):
    if not isinstance(days, list) or not days:
        raise HTTPException(status_code=400, detail="At least one timesheet day is required")

    has_any_entry = False
    leave_types = {"public_holiday", "annual_leave", "sick"}

    def norm_type(value):
        raw = str(value or "work").strip().lower().replace("-", "_").replace(" ", "_")
        if "public" in raw and "holiday" in raw:
            return "public_holiday"
        if ("ann" in raw or "annual" in raw) and "leave" in raw:
            return "annual_leave"
        if "sick" in raw:
            return "sick"
        return raw

    def has_value(value):
        return value is not None and str(value).strip() != ""

    required_work_fields = [
        ("start_time", "Start time"),
        ("lunch_duration", "Lunch"),
        ("finish_time", "Finish time"),
        ("job_number", "Job number"),
        ("task_code", "Task code"),
        ("project_manager_id", "Project manager"),
    ]

    for day in days:
        day_name = (day or {}).get("day", "timesheet day") if isinstance(day, dict) else "timesheet day"
        entries = (day or {}).get("entries", []) if isinstance(day, dict) else []

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            entry_type = norm_type(entry.get("type"))
            total_hours = float(entry.get("total_hours") or 0)

            if entry_type in leave_types:
                if total_hours <= 0:
                    raise HTTPException(status_code=400, detail=f"Leave hours are required on {day_name}")
                has_any_entry = True
                continue

            row_has_any_value = any(has_value(entry.get(field)) for field, _ in required_work_fields) or total_hours > 0
            if not row_has_any_value:
                continue

            has_any_entry = True

            for field, label in required_work_fields:
                if not has_value(entry.get(field)):
                    raise HTTPException(status_code=400, detail=f"{label} is required for work entry on {day_name}")

            if total_hours <= 0:
                raise HTTPException(status_code=400, detail=f"Hours are required for work entry on {day_name}")

    if not has_any_entry:
        raise HTTPException(status_code=400, detail="No valid timesheet entries found")

    if require_signature and not has_value(employee_signature):
        raise HTTPException(status_code=400, detail="Employee signature is required")

# ==================== TIMESHEET ENDPOINTS ====================

@api_router.post("/timesheets")
async def create_timesheet(timesheet: TimesheetCreate, request: Request):
    user = await get_current_user(request)

    week_ending_value = (timesheet.week_ending or "").strip()
    if not week_ending_value:
        raise HTTPException(status_code=400, detail="Week ending is required")

    try:
        week_ending_date = datetime.fromisoformat(week_ending_value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid week ending date")

    if week_ending_date.year < 2020:
        raise HTTPException(status_code=400, detail="Invalid week ending date")

    days_data = [d.model_dump() for d in timesheet.days]
    validate_timesheet_entries(days_data, require_signature=True, employee_signature=timesheet.employee_signature)

    # Determine which PM(s) are involved
    pm_ids = set()
    for day in timesheet.days:
        for entry in day.entries:
            if entry.project_manager_id:
                pm_ids.add(entry.project_manager_id)

    doc = {
        "user_id": user["id"],
        "employee_name": timesheet.employee_name,
        "week_ending": week_ending_value,
        "period_type": timesheet.period_type,
        "days": [d.model_dump() for d in timesheet.days],
        "messages": timesheet.messages,
        "nights_away": timesheet.nights_away,
        "total_hours": timesheet.total_hours,
        "employee_signature": timesheet.employee_signature,
        "status": "submitted",
        "pm_ids": list(pm_ids),
        "pm_signatures": [],  # List of {pm_id, pm_name, signature, signed_at}
        "pm_approved": False,
        "pm_approved_by": None,
        "pm_approved_at": None,
        "admin_approved": False,
        "admin_approved_by": None,
        "admin_approved_at": None,
        "rejection_comment": None,
          "pm_edit_history": [],
          "pm_last_edited_by": None,
          "pm_last_edited_name": None,
          "pm_last_edited_at": None,
          "pm_edit_reason": None,
          "pm_edit_count": 0,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)
    }
    result = await db.timesheets.insert_one(doc)

    # Save defaults for next entry
    await db.user_defaults.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "employee_name": timesheet.employee_name,
            "period_type": timesheet.period_type,
            "last_days": [d.model_dump() for d in timesheet.days],
            "updated_at": datetime.now(timezone.utc)
        }},
        upsert=True
    )

    return {"id": str(result.inserted_id), "status": "submitted", "message": "Timesheet submitted successfully"}
@api_router.get("/timesheets")
async def get_timesheets(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    
    query = {}
    if user["role"] == "employee":
        query["user_id"] = user["id"]
    elif user["role"] == "project_manager":
        # PM sees timesheets assigned to them OR their own
        pm = await db.project_managers.find_one({"email": user["email"]})
        if pm:
            query["$or"] = [
                {"user_id": user["id"]},
                {"pm_ids": str(pm["_id"])}
            ]
        else:
            query["user_id"] = user["id"]
    # Admin sees all
    
    if status:
        query["status"] = status
    
    timesheets = await db.timesheets.find(query, {
        "_id": 1,
        "user_id": 1,
        "employee_name": 1,
        "week_ending": 1,
        "period_type": 1,
        "total_hours": 1,
        "days": 1,
        "status": 1,
        "pm_approved": 1,
        "admin_approved": 1,
        "created_at": 1
    }).sort("created_at", -1).to_list(1000)

    def calc_total_from_days(days):
        total = 0.0
        for day in days or []:
            for entry in day.get("entries", []):
                try:
                    total += float(entry.get("total_hours", 0) or 0)
                except Exception:
                    pass
        return total

    return [{
        "id": str(t["_id"]),
        "user_id": t.get("user_id", ""),
        "employee_name": t.get("employee_name", ""),
        "week_ending": t.get("week_ending"),
        "period_type": t.get("period_type", ""),
        "total_hours": calc_total_from_days(t.get("days", [])),
        "status": t.get("status", "draft"),
        "pm_approved": t.get("pm_approved", False),
        "admin_approved": t.get("admin_approved", False),
        "created_at": t.get("created_at").isoformat() if isinstance(t.get("created_at"), datetime) else str(t.get("created_at"))
    } for t in timesheets]



def _clean_export_text(value):
    if value is None:
        return ""
    return str(value).strip()

def _split_employee_name(full_name):
    name = _clean_export_text(full_name)
    if not name:
        return "", ""
    parts = name.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])

def _resolve_work_date(week_ending_value, day_name):
    if not week_ending_value or not day_name:
        return ""
    day_name_to_offset = {
        "Monday": -6,
        "Tuesday": -5,
        "Wednesday": -4,
        "Thursday": -3,
        "Friday": -2,
        "Saturday": -1,
        "Sunday": 0
    }
    try:
        week_date = datetime.fromisoformat(str(week_ending_value)).date()
    except Exception:
        return ""
    if day_name not in day_name_to_offset:
        return ""
    try:
        return (week_date + timedelta(days=day_name_to_offset[day_name])).isoformat()
    except Exception:
        return ""

def _format_smartly_datetime(date_value, time_value):
    if not date_value or not time_value:
        return ""
    try:
        date_text = datetime.fromisoformat(str(date_value)).strftime("%d/%m/%Y")
    except Exception:
        date_text = str(date_value)
    return f"{date_text} {time_value}"


async def _build_smartly_export_bundle(week_ending: Optional[str] = None, pay_group: Optional[str] = None):
    query = {"status": "approved"}
    if week_ending and week_ending != "all":
        query["week_ending"] = week_ending

    timesheets = await db.timesheets.find(query, {
        "_id": 1,
        "user_id": 1,
        "employee_name": 1,
        "week_ending": 1,
        "period_type": 1,
        "days": 1,
        "messages": 1,
        "total_hours": 1
    }).sort("week_ending", -1).to_list(5000)

    user_object_ids = []
    seen_user_ids = set()
    for ts in timesheets:
        user_id = ts.get("user_id")
        if not user_id or user_id in seen_user_ids:
            continue
        seen_user_ids.add(user_id)
        try:
            user_object_ids.append(ObjectId(user_id))
        except Exception:
            pass

    users = []
    if user_object_ids:
        users = await db.users.find({
            "_id": {"$in": user_object_ids}
        }, {
            "_id": 1,
            "name": 1,
            "smartly_employee_code": 1,
            "smartly_pay_group": 1,
            "payroll_treatment": 1,
            "smartly_costing_mode": 1,
            "smartly_has_standard_hours": 1
        }).to_list(5000)

    users_by_id = {str(u["_id"]): u for u in users}

    task_codes = await db.task_codes.find({}, {
        "_id": 0,
        "code": 1,
        "description": 1,
        "smartly_department_quick_code": 1,
        "smartly_export_enabled": 1
    }).to_list(5000)

    task_codes_by_code = {}
    for tc in task_codes:
        code = _clean_export_text(tc.get("code"))
        if code:
            task_codes_by_code[code] = tc

    ready_rows = []
    issues = []
    exclusions = []
    ready_pay_groups = set()
    available_pay_groups = set()
    ready_timesheet_ids = set()
    ready_user_ids = set()

    for timesheet in timesheets:
        timesheet_id = str(timesheet.get("_id", ""))
        user_id = _clean_export_text(timesheet.get("user_id"))
        employee_name = _clean_export_text(timesheet.get("employee_name"))
        first_name, surname = _split_employee_name(employee_name)
        week_value = _clean_export_text(timesheet.get("week_ending"))
        user_doc = users_by_id.get(user_id)

        if not user_doc:
            issues.append({
                "timesheet_id": timesheet_id,
                "employee_name": employee_name,
                "week_ending": week_value,
                "reason": "Missing user payroll settings record"
            })
            continue

        payroll_treatment = _clean_export_text(user_doc.get("payroll_treatment") or "payroll_employee") or "payroll_employee"
        smartly_employee_code = _clean_export_text(user_doc.get("smartly_employee_code"))
        smartly_pay_group = _clean_export_text(user_doc.get("smartly_pay_group"))
        smartly_costing_mode = _clean_export_text(user_doc.get("smartly_costing_mode") or "define_now") or "define_now"

        if smartly_pay_group:
            available_pay_groups.add(smartly_pay_group)

        if pay_group and pay_group != "all" and smartly_pay_group != pay_group:
            continue

        if payroll_treatment in ["hold_from_export", "contractor_verify_only"]:
            exclusions.append({
                "timesheet_id": timesheet_id,
                "employee_name": employee_name,
                "week_ending": week_value,
                "reason": payroll_treatment
            })
            continue

        if not smartly_employee_code:
            issues.append({
                "timesheet_id": timesheet_id,
                "employee_name": employee_name,
                "week_ending": week_value,
                "reason": "Missing Smartly employee code"
            })
            continue

        if not smartly_pay_group:
            issues.append({
                "timesheet_id": timesheet_id,
                "employee_name": employee_name,
                "week_ending": week_value,
                "reason": "Missing Smartly pay group"
            })
            continue

        has_ready_rows = False

        for day in (timesheet.get("days", []) or []):
            day_name = _clean_export_text(day.get("day"))
            for entry in (day.get("entries", []) or []):
                entry_type = _clean_export_text(entry.get("type") or "work") or "work"
                try:
                    hours = float(entry.get("total_hours", 0) or 0)
                except Exception:
                    hours = 0.0

                if hours <= 0:
                    continue

                task_code = _clean_export_text(entry.get("task_code"))
                job_number = _clean_export_text(entry.get("job_number"))
                description = _clean_export_text(entry.get("description") or entry.get("other"))
                start_time = _clean_export_text(entry.get("start_time"))
                finish_time = _clean_export_text(entry.get("finish_time"))
                break_minutes = _clean_export_text(entry.get("lunch_duration") or "0")
                work_date = _resolve_work_date(week_value, day_name)
                smartly_department_quick_code = ""

                if entry_type != "work":
                    exclusions.append({
                        "timesheet_id": timesheet_id,
                        "employee_name": employee_name,
                        "week_ending": week_value,
                        "reason": f"Non-work row not included in Smartly work export: {entry_type}",
                        "day": day_name
                    })
                    continue

                if not start_time or not finish_time:
                    issues.append({
                        "timesheet_id": timesheet_id,
                        "employee_name": employee_name,
                        "week_ending": week_value,
                        "reason": "Missing start/finish on work row",
                        "day": day_name
                    })
                    continue

                if not work_date:
                    issues.append({
                        "timesheet_id": timesheet_id,
                        "employee_name": employee_name,
                        "week_ending": week_value,
                        "reason": "Could not resolve work date from week ending/day",
                        "day": day_name
                    })
                    continue

                if entry_type == "work":
                    if not task_code:
                        issues.append({
                            "timesheet_id": timesheet_id,
                            "employee_name": employee_name,
                            "week_ending": week_value,
                            "reason": "Missing task code on work row",
                            "day": day_name
                        })
                        continue

                    task_doc = task_codes_by_code.get(task_code)
                    if not task_doc:
                        issues.append({
                            "timesheet_id": timesheet_id,
                            "employee_name": employee_name,
                            "week_ending": week_value,
                            "reason": f"Unknown task code: {task_code}",
                            "day": day_name
                        })
                        continue

                    if task_doc.get("smartly_export_enabled") is False:
                        exclusions.append({
                            "timesheet_id": timesheet_id,
                            "employee_name": employee_name,
                            "week_ending": week_value,
                            "reason": f"Task code export disabled: {task_code}",
                            "day": day_name
                        })
                        continue

                    smartly_department_quick_code = _clean_export_text(task_doc.get("smartly_department_quick_code"))
                    if smartly_costing_mode == "enter_at_pay_time" and not smartly_department_quick_code:
                        issues.append({
                            "timesheet_id": timesheet_id,
                            "employee_name": employee_name,
                            "week_ending": week_value,
                            "reason": f"Missing Smartly dept code for task code: {task_code}",
                            "day": day_name
                        })
                        continue

                task_label = _clean_export_text(task_doc.get("description")) if task_doc else ""
                costed_to = ""
                if job_number and smartly_department_quick_code:
                    costed_to = f"{job_number} > {smartly_department_quick_code}"
                elif smartly_department_quick_code:
                    costed_to = smartly_department_quick_code
                elif job_number and task_label:
                    costed_to = f"{job_number} > {task_label}"
                else:
                    costed_to = job_number or task_code

                employee_comments = description or task_code or job_number

                ready_rows.append({
                    "timesheet_id": timesheet_id,
                    "employee_name": employee_name,
                    "first_name": first_name,
                    "surname": surname,
                    "pay_group": smartly_pay_group,
                    "status": "Approved",
                    "start_display": _format_smartly_datetime(work_date, start_time),
                    "end_display": _format_smartly_datetime(work_date, finish_time),
                    "break_minutes": break_minutes or "0",
                    "hours_worked": hours,
                    "costed_to": costed_to,
                    "employee_comments": employee_comments,
                    "approver_comments": "",
                    "job_number": job_number,
                    "task_code": task_code,
                    "work_date": work_date,
                    "start_time": start_time,
                    "finish_time": finish_time,
                    "smartly_employee_code": smartly_employee_code,
                    "smartly_department_quick_code": smartly_department_quick_code,
                    "description": description
                })

                ready_pay_groups.add(smartly_pay_group)
                ready_timesheet_ids.add(timesheet_id)
                ready_user_ids.add(user_id)
                has_ready_rows = True

        if not has_ready_rows:
            exclusions.append({
                "timesheet_id": timesheet_id,
                "employee_name": employee_name,
                "week_ending": week_value,
                "reason": "No export-ready rows"
            })

    return {
        "week_ending": week_ending or "all",
        "pay_group": pay_group or "all",
        "available_pay_groups": sorted(available_pay_groups),
        "ready_pay_groups": sorted(ready_pay_groups),
        "ready_timesheet_count": len(ready_timesheet_ids),
        "ready_employee_count": len(ready_user_ids),
        "ready_row_count": len(ready_rows),
        "issues": issues,
        "exclusions": exclusions,
        "ready_rows": ready_rows
    }

@api_router.get("/timesheets/smartly-export-summary")
async def get_smartly_export_summary(
    request: Request,
    week_ending: Optional[str] = None,
    pay_group: Optional[str] = None
):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    bundle = await _build_smartly_export_bundle(week_ending=week_ending, pay_group=pay_group)
    return {
        "week_ending": bundle["week_ending"],
        "pay_group": bundle["pay_group"],
        "available_pay_groups": bundle["available_pay_groups"],
        "ready_pay_groups": bundle["ready_pay_groups"],
        "ready_timesheet_count": bundle["ready_timesheet_count"],
        "ready_employee_count": bundle["ready_employee_count"],
        "ready_row_count": bundle["ready_row_count"],
        "issue_count": len(bundle["issues"]),
        "exclusion_count": len(bundle["exclusions"]),
        "issues": bundle["issues"][:200],
        "exclusions": bundle["exclusions"][:200],
        "preview_rows": bundle["ready_rows"][:50]
    }

@api_router.get("/timesheets/smartly-export.csv")
async def export_smartly_batch_csv(
    request: Request,
    week_ending: Optional[str] = None,
    pay_group: Optional[str] = None
):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    bundle = await _build_smartly_export_bundle(week_ending=week_ending, pay_group=pay_group)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "PayGroup",
        "First Name",
        "Surname",
        "Status",
        "StartTime",
        "EndTime",
        "Break",
        "HoursWorked",
        "Costed To",
        "Employee Comments",
        "Approver Comments"
    ])

    for row in bundle["ready_rows"]:
        writer.writerow([
            row["pay_group"],
            row["first_name"],
            row["surname"],
            row["status"],
            row["start_display"],
            row["end_display"],
            row["break_minutes"],
            row["hours_worked"],
            row["costed_to"],
            row["employee_comments"],
            row["approver_comments"]
        ])

    csv_content = output.getvalue()
    output.close()

    safe_week = week_ending if week_ending and week_ending != "all" else "all-weeks"
    safe_group = pay_group if pay_group and pay_group != "all" else "all-pay-groups"
    filename = f"smartly_batch_{safe_group}_{safe_week}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename=""{filename}""'}
    )

@api_router.get("/timesheets/export.csv")
async def export_timesheets_csv(
    request: Request,
    status: Optional[str] = None,
    week_ending: Optional[str] = None
):
    user = await get_current_user(request)

    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    status_map = {
        "pending_pm": "submitted",
        "pending_admin": "pm_approved",
        "approved": "approved",
        "rejected": "rejected",
        "not_approved": "rejected"
    }

    query = {}
    if status and status != "all":
        query["status"] = status_map.get(status, status)
    if week_ending and week_ending != "all":
        query["week_ending"] = week_ending

    timesheets = await db.timesheets.find(query, {
        "_id": 1,
        "employee_name": 1,
        "week_ending": 1,
        "period_type": 1,
        "days": 1,
        "status": 1,
        "messages": 1,
        "nights_away": 1,
        "total_hours": 1,
        "created_at": 1
    }).sort("week_ending", -1).to_list(5000)

    status_labels = {
        "submitted": "Pending PM",
        "pm_approved": "Pending Admin",
        "approved": "Approved",
        "rejected": "Not Approved"
    }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Employee",
        "Week Ending",
        "Period",
        "Status",
        "Day",
        "Entry Type",
        "Start",
        "Finish",
        "Hours",
        "Job Number",
        "Task Code",
        "Project Manager",
        "Messages",
        "Nights Away",
        "Created At"
    ])

    for timesheet in timesheets:
        days = timesheet.get("days", []) or []
        created_at = timesheet.get("created_at")
        created_at_text = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")
        status_value = timesheet.get("status", "")
        status_label = status_labels.get(status_value, status_value)

        wrote_row = False
        for day in days:
            day_name = day.get("day", "")
            for entry in (day.get("entries", []) or []):
                writer.writerow([
                    timesheet.get("employee_name", ""),
                    timesheet.get("week_ending", ""),
                    timesheet.get("period_type", ""),
                    status_label,
                    day_name,
                    entry.get("type", "work"),
                    entry.get("start_time", ""),
                    entry.get("finish_time", ""),
                    entry.get("total_hours", 0),
                    entry.get("job_number", ""),
                    entry.get("task_code", ""),
                    entry.get("project_manager_id", ""),
                    timesheet.get("messages", "") or "",
                    timesheet.get("nights_away", 0) or 0,
                    created_at_text
                ])
                wrote_row = True

        if not wrote_row:
            writer.writerow([
                timesheet.get("employee_name", ""),
                timesheet.get("week_ending", ""),
                timesheet.get("period_type", ""),
                status_label,
                "",
                "",
                "",
                "",
                timesheet.get("total_hours", 0) or 0,
                "",
                "",
                "",
                timesheet.get("messages", "") or "",
                timesheet.get("nights_away", 0) or 0,
                created_at_text
            ])

    csv_content = output.getvalue()
    output.close()

    filename_parts = ["timesheets"]
    if status and status != "all":
        filename_parts.append(status)
    if week_ending and week_ending != "all":
        filename_parts.append(week_ending)
    filename = "_".join(filename_parts) + ".csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
@api_router.get("/timesheets/{timesheet_id}")
async def get_timesheet(timesheet_id: str, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    # Check access
    if user["role"] == "employee" and timesheet.get("user_id", "") != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if user["role"] == "project_manager" and timesheet.get("user_id", "") != user["id"]:
        approver_pm = await db.project_managers.find_one({"email": user["email"]})
        approver_pm_id = str(approver_pm["_id"]) if approver_pm else None
        assigned_pm_ids = [str(pm_id) for pm_id in (timesheet.get("pm_ids", []) or []) if pm_id]

        if not approver_pm_id or approver_pm_id not in assigned_pm_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    return {
        "id": str(timesheet["_id"]),
        "user_id": timesheet.get("user_id", ""),
        "employee_name": timesheet.get("employee_name", ""),
        "week_ending": timesheet.get("week_ending"),
        "period_type": timesheet.get("period_type", ""),
        "days": timesheet.get("days", []),
        "messages": timesheet.get("messages"),
        "nights_away": timesheet.get("nights_away", 0),
        "total_hours": timesheet.get("total_hours", 0),
        "status": timesheet.get("status", "draft"),
        "pm_ids": timesheet.get("pm_ids", []),
        "pm_signatures": timesheet.get("pm_signatures", []),
        "employee_signature": timesheet.get("employee_signature"),
        "pm_approved": timesheet.get("pm_approved", False),
        "pm_approved_by": timesheet.get("pm_approved_by"),
        "pm_approved_at": timesheet.get("pm_approved_at").isoformat() if isinstance(timesheet.get("pm_approved_at"), datetime) else timesheet.get("pm_approved_at"),
        "admin_approved": timesheet.get("admin_approved", False),
        "admin_approved_by": timesheet.get("admin_approved_by"),
        "admin_approved_at": timesheet.get("admin_approved_at").isoformat() if isinstance(timesheet.get("admin_approved_at"), datetime) else timesheet.get("admin_approved_at"),
        "rejection_comment": timesheet.get("rejection_comment"),
        "pm_last_edited_by": timesheet.get("pm_last_edited_by"),
        "pm_last_edited_name": timesheet.get("pm_last_edited_name"),
        "pm_last_edited_at": timesheet.get("pm_last_edited_at").isoformat() if isinstance(timesheet.get("pm_last_edited_at"), datetime) else timesheet.get("pm_last_edited_at"),
        "pm_edit_reason": timesheet.get("pm_edit_reason"),
        "pm_edit_count": timesheet.get("pm_edit_count", 0),
        "pm_edit_history": timesheet.get("pm_edit_history", []),
        "created_at": timesheet.get("created_at").isoformat() if isinstance(timesheet.get("created_at"), datetime) else str(timesheet.get("created_at")),
        "updated_at": timesheet.get("updated_at").isoformat() if isinstance(timesheet.get("updated_at"), datetime) else str(timesheet.get("updated_at"))
    }

@api_router.put("/timesheets/{timesheet_id}")
async def update_timesheet(timesheet_id: str, update: TimesheetUpdate, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    is_owner = timesheet.get("user_id", "") == user["id"]
    is_admin = user["role"] == "admin"
    is_assigned_pm = False

    if user["role"] == "project_manager" and not is_owner:
        approver_pm = await db.project_managers.find_one({"email": user["email"]})
        approver_pm_id = str(approver_pm["_id"]) if approver_pm else None
        assigned_pm_ids = [str(pm_id) for pm_id in (timesheet.get("pm_ids", []) or []) if pm_id]
        is_assigned_pm = bool(approver_pm_id and approver_pm_id in assigned_pm_ids)

    if not (is_owner or is_admin or is_assigned_pm):
        raise HTTPException(status_code=403, detail="Access denied")

    if timesheet.get("status", "draft") != "submitted" and timesheet.get("status", "draft") != "rejected":
        raise HTTPException(status_code=400, detail="Cannot edit approved timesheet")
    
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}

    if is_assigned_pm:
        pm_edit_reason = (update.pm_edit_reason or "").strip()
        if not pm_edit_reason:
            raise HTTPException(status_code=400, detail="PM edit reason is required")

        update_data["pm_last_edited_by"] = user["id"]
        update_data["pm_last_edited_name"] = user["name"]
        update_data["pm_last_edited_at"] = datetime.now(timezone.utc)
        update_data["pm_edit_reason"] = pm_edit_reason
        update_data["pm_edit_count"] = int(timesheet.get("pm_edit_count", 0) or 0) + 1
        pm_edit_history = list(timesheet.get("pm_edit_history", []) or [])
        pm_edit_history.append({
            "edited_by": user["id"],
            "edited_name": user["name"],
            "edited_at": datetime.now(timezone.utc).isoformat(),
            "reason": pm_edit_reason
        })
        update_data["pm_edit_history"] = pm_edit_history
        update_data["pm_last_pre_edit_snapshot"] = {
            "week_ending": timesheet.get("week_ending"),
            "period_type": timesheet.get("period_type"),
            "days": timesheet.get("days", []),
            "messages": timesheet.get("messages"),
            "nights_away": timesheet.get("nights_away", 0),
            "total_hours": timesheet.get("total_hours", 0),
            "status": timesheet.get("status", "draft"),
            "captured_at": datetime.now(timezone.utc).isoformat()
        }
    if "days" in update_data:
        update_data["days"] = [d if isinstance(d, dict) else d.model_dump() for d in update_data["days"]]
        # Recalculate PM IDs
        pm_ids = set()
        for day in update_data["days"]:
            for entry in day.get("entries", []):
                if entry.get("project_manager_id"):
                    pm_ids.add(entry["project_manager_id"])
        update_data["pm_ids"] = list(pm_ids)
    
    effective_days = update_data.get("days", timesheet.get("days", []))
    effective_signature = update_data.get("employee_signature", timesheet.get("employee_signature"))
    validate_timesheet_entries(
        effective_days,
        require_signature=is_owner,
        employee_signature=effective_signature
    )

    update_data["updated_at"] = datetime.now(timezone.utc)
    update_data["status"] = "submitted"
    update_data["pm_approved"] = False
    update_data["admin_approved"] = False
    update_data["pm_signatures"] = []
    update_data["pm_approved_by"] = None
    update_data["pm_approved_at"] = None
    update_data["admin_approved_by"] = None
    update_data["admin_approved_at"] = None
    update_data["rejection_comment"] = None
    
    await db.timesheets.update_one({"_id": ObjectId(timesheet_id)}, {"$set": update_data})
    return {"message": "Timesheet updated"}

@api_router.delete("/timesheets/{timesheet_id}")
async def delete_timesheet(timesheet_id: str, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    if timesheet.get("user_id", "") != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    await db.timesheets.delete_one({"_id": ObjectId(timesheet_id)})
    return {"message": "Timesheet deleted"}

@api_router.post("/timesheets/{timesheet_id}/pm-approve")
async def pm_approve_timesheet(timesheet_id: str, approval: TimesheetApproval, request: Request):
    user = await get_current_user(request)
    
    if user["role"] not in ["project_manager", "admin"]:
        raise HTTPException(status_code=403, detail="PM or Admin only")
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")

    if timesheet.get("status") != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted timesheets can be PM approved")
    
    if approval.action == "approve":
        assigned_pm_ids = [str(pm_id) for pm_id in (timesheet.get("pm_ids", []) or []) if pm_id]

        approver_pm = await db.project_managers.find_one({"email": user["email"]})
        approver_pm_id = str(approver_pm["_id"]) if approver_pm else None
        approver_pm_name = approver_pm["name"] if approver_pm and approver_pm.get("name") else user["name"]

        if assigned_pm_ids:
            if not approver_pm_id or approver_pm_id not in assigned_pm_ids:
                raise HTTPException(status_code=403, detail="You are not assigned to approve this timesheet")
        else:
            approver_pm_id = approver_pm_id or user["id"]

        if not approval.signature:
            raise HTTPException(status_code=400, detail="Signature is required")

        existing_signatures = timesheet.get("pm_signatures", []) or []

        if any((s.get("pm_id") == approver_pm_id) for s in existing_signatures):
            raise HTTPException(status_code=400, detail="You have already signed this timesheet")

        pm_signature_data = {
            "pm_id": approver_pm_id,
            "pm_name": approver_pm_name,
            "signature": approval.signature,
            "signed_at": datetime.now(timezone.utc).isoformat()
        }

        existing_signatures.append(pm_signature_data)

        pm_ids_signed = {str(s.get("pm_id")) for s in existing_signatures if s.get("pm_id")}
        all_pms_signed = all(pm_id in pm_ids_signed for pm_id in assigned_pm_ids) if assigned_pm_ids else len(existing_signatures) > 0

        update_data = {
            "pm_signatures": existing_signatures,
            "updated_at": datetime.now(timezone.utc)
        }

        if all_pms_signed:
            update_data["pm_approved"] = True
            update_data["pm_approved_by"] = user["id"]
            update_data["pm_approved_at"] = datetime.now(timezone.utc)
            update_data["status"] = "pm_approved"

        await db.timesheets.update_one(
            {"_id": ObjectId(timesheet_id)},
            {"$set": update_data}
        )

        if all_pms_signed:
            return {"message": "Timesheet approved by PM"}

        remaining_pm_signatures = len([pm_id for pm_id in assigned_pm_ids if pm_id not in pm_ids_signed])
        return {
            "message": "PM signature recorded; awaiting additional PM signatures",
            "remaining_pm_signatures": remaining_pm_signatures
        }
    else:
        await db.timesheets.update_one(
            {"_id": ObjectId(timesheet_id)},
            {"$set": {
                "status": "rejected",
                "rejection_comment": approval.comment,
                "updated_at": datetime.now(timezone.utc)
            }}
        )
        return {"message": "Timesheet rejected"}

@api_router.post("/timesheets/{timesheet_id}/admin-approve")
async def admin_approve_timesheet(timesheet_id: str, approval: TimesheetApproval, request: Request):
    user = await get_current_user(request)
    
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")

    if timesheet.get("status") != "pm_approved":
        raise HTTPException(status_code=400, detail="Only PM approved timesheets can be admin approved")
    
    if approval.action == "approve":
        await db.timesheets.update_one(
            {"_id": ObjectId(timesheet_id)},
            {"$set": {
                "admin_approved": True,
                "admin_approved_by": user["id"],
                "admin_approved_at": datetime.now(timezone.utc),
                "status": "approved",
                "updated_at": datetime.now(timezone.utc)
            }}
        )
        try:
            auth_header = request.headers.get("Authorization", "")
            rows = []
            print("FITOUT SYNC START")

            week_ending_value = timesheet.get("week_ending")
            day_name_to_offset = {
                "Monday": -6,
                "Tuesday": -5,
                "Wednesday": -4,
                "Thursday": -3,
                "Friday": -2,
                "Saturday": -1,
                "Sunday": 0
            }

            week_ending_date = None
            if week_ending_value:
                try:
                    week_ending_date = datetime.fromisoformat(str(week_ending_value)).date()
                except Exception:
                    week_ending_date = None

            for day in timesheet.get("days", []):
                day_name = day.get("day")
                work_date = None

                if week_ending_date and day_name in day_name_to_offset:
                    try:
                        work_date = (week_ending_date + timedelta(days=day_name_to_offset[day_name])).isoformat()
                    except Exception:
                        work_date = None

                for entry in day.get("entries", []):
                    try:
                        hours = float(entry.get("total_hours", 0) or 0)
                    except Exception:
                        hours = 0

                    if hours <= 0:
                        continue

                    job_number = entry.get("job_number")
                    if not job_number:
                        continue

                    rows.append({
                        "job_number": str(job_number),
                        "task_code": entry.get("task_code"),
"task_name": entry.get("task_name") or entry.get("description"),
"description": entry.get("description"),
"zone_area": entry.get("zone_area"),
"task_id": entry.get("task_id"),
"date": entry.get("date"),
"hours": entry.get("hours"),
"trade": entry.get("trade"),
"source_id": entry.get("id"),
                        "date": work_date or str(week_ending_value),
                        "hours": hours
                    })

            print("FITOUT SYNC ROW COUNT:", len(rows))
            if rows and auth_header.startswith("Bearer "):
                payload = json.dumps({"rows": rows}).encode("utf-8")
                req = urllib.request.Request(
                    "http://127.0.0.1:8010/api/labour/import",
                    data=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": auth_header
                    },
                    method="POST"
                )
                print("FITOUT SYNC POSTING")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    print("FITOUT SYNC RESPONSE:", resp.status)
                    resp.read()
        except Exception as e:
            print("FITOUT AUTO SYNC ERROR:", str(e))

        return {"message": "Timesheet fully approved"}
    else:
        await db.timesheets.update_one(
            {"_id": ObjectId(timesheet_id)},
            {"$set": {
                "status": "rejected",
                "rejection_comment": approval.comment,
                "pm_approved": False,
                "updated_at": datetime.now(timezone.utc)
            }}
        )
        return {"message": "Timesheet rejected"}

# ==================== USER DEFAULTS ====================

@api_router.get("/user-defaults")
async def get_user_defaults(request: Request):
    user = await get_current_user(request)
    defaults = await db.user_defaults.find_one({"user_id": user["id"]}, {"_id": 0, "user_id": 0})
    return defaults or {}

# ==================== NOTIFICATION SETTINGS ====================

@api_router.get("/notification-settings")
async def get_notification_settings(request: Request):
    user = await get_current_user(request)
    db_user = await db.users.find_one({"_id": ObjectId(user["id"])})
    return db_user.get("notification_settings", {
        "reminder_time": "17:00",
        "reminder_day": "Friday",
        "enabled": True
    })

@api_router.put("/notification-settings")
async def update_notification_settings(settings: NotificationSettingsUpdate, request: Request):
    user = await get_current_user(request)
    await db.users.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {"notification_settings": settings.model_dump()}}
    )
    return {"message": "Settings updated"}

# ==================== USERS MANAGEMENT (Admin) ====================

@api_router.get("/users")
async def get_users(request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    users = await db.users.find(
        {},
        {
            "_id": 1,
            "email": 1,
            "name": 1,
            "role": 1,
            "created_at": 1,
            "smartly_employee_code": 1,
            "smartly_pay_group": 1,
            "payroll_treatment": 1,
            "smartly_costing_mode": 1,
            "smartly_has_standard_hours": 1,
            "is_pro": 1,
        },
    ).to_list(1000)

    allowed_roles = {"employee", "project_manager", "admin"}
    safe_users = []

    for u in users:
        role = u.get("role")
        if role not in allowed_roles:
            continue

        # Skip unrelated app user records that may share the local Mongo users collection.
        if u.get("is_pro") is True:
            continue

        created_at = u.get("created_at", "")
        safe_users.append({
            "id": str(u.get("_id", "")),
            "email": u.get("email", ""),
            "name": u.get("name", ""),
            "role": role,
            "smartly_employee_code": u.get("smartly_employee_code", ""),
            "smartly_pay_group": u.get("smartly_pay_group", ""),
            "payroll_treatment": u.get("payroll_treatment", "payroll_employee"),
            "smartly_costing_mode": u.get("smartly_costing_mode", "define_now"),
            "smartly_has_standard_hours": u.get("smartly_has_standard_hours", True),
            "created_at": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or ""),
        })

    return safe_users

@api_router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    body = await request.json()
    new_role = body.get("role")
    if new_role not in ["employee", "project_manager", "admin"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"role": new_role}})
    return {"message": "Role updated"}

@api_router.put("/users/{user_id}/payroll-settings")
async def update_user_payroll_settings(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    body = await request.json()
    payroll_treatment = (body.get("payroll_treatment") or "payroll_employee").strip()
    smartly_costing_mode = (body.get("smartly_costing_mode") or "define_now").strip()
    smartly_employee_code = (body.get("smartly_employee_code") or "").strip()
    smartly_pay_group = (body.get("smartly_pay_group") or "").strip()
    smartly_has_standard_hours = body.get("smartly_has_standard_hours")

    allowed_treatments = ["payroll_employee", "hold_from_export", "contractor_verify_only", "contractor_in_smartly"]
    allowed_costing_modes = ["define_now", "enter_at_pay_time"]

    if payroll_treatment not in allowed_treatments:
        raise HTTPException(status_code=400, detail="Invalid payroll treatment")

    if smartly_costing_mode not in allowed_costing_modes:
        raise HTTPException(status_code=400, detail="Invalid Smartly costing mode")

    if smartly_has_standard_hours is None:
        smartly_has_standard_hours = True
    else:
        smartly_has_standard_hours = bool(smartly_has_standard_hours)

    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "smartly_employee_code": smartly_employee_code,
            "smartly_pay_group": smartly_pay_group,
            "payroll_treatment": payroll_treatment,
            "smartly_costing_mode": smartly_costing_mode,
            "smartly_has_standard_hours": smartly_has_standard_hours
        }}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"message": "Payroll settings updated"}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    await db.users.delete_one({"_id": ObjectId(user_id)})
    return {"message": "User deleted"}

# ==================== DASHBOARD STATS ====================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request):
    user = await get_current_user(request)
    
    if user["role"] == "admin":
        total = await db.timesheets.count_documents({})
        pending_pm = await db.timesheets.count_documents({"status": "submitted"})
        pending_admin = await db.timesheets.count_documents({"status": "pm_approved"})
        approved = await db.timesheets.count_documents({"status": "approved"})
        rejected = await db.timesheets.count_documents({"status": "rejected"})
        return {
            "total": total,
            "pending_pm_approval": pending_pm,
            "pending_admin_approval": pending_admin,
            "approved": approved,
            "rejected": rejected
        }
    elif user["role"] == "project_manager":
        pm = await db.project_managers.find_one({"email": user["email"]})
        if pm:
            pending = await db.timesheets.count_documents({"pm_ids": str(pm["_id"]), "status": "submitted"})
        else:
            pending = 0
        my_total = await db.timesheets.count_documents({"user_id": user["id"]})
        return {"pending_approval": pending, "my_timesheets": my_total}
    else:
        my_total = await db.timesheets.count_documents({"user_id": user["id"]})
        my_approved = await db.timesheets.count_documents({"user_id": user["id"], "status": "approved"})
        my_pending = await db.timesheets.count_documents({"user_id": user["id"], "status": {"$in": ["submitted", "pm_approved"]}})
        return {"total": my_total, "approved": my_approved, "pending": my_pending}

# ==================== STARTUP EVENTS ====================

@app.on_event("startup")
async def startup_event():
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.task_codes.create_index("code", unique=True)
    await db.project_managers.create_index("initials", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.timesheets.create_index("user_id")
    await db.timesheets.create_index("status")
    
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@timesheet.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hashed,
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
            "notification_settings": {"reminder_time": "17:00", "reminder_day": "Friday", "enabled": True}
        })
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")
    
    # Seed default task codes
    default_codes = [
        ("101", "Suspended Ceilings / 2-way"),
        ("102", "Rondo Ceilings"),
        ("103", "Partition Walls"),
        ("104", "Aluminium"),
        ("105", "Plasterboard / Linings"),
        ("106", "Stopping"),
        ("107", "Insulation"),
        ("108", "Carpentry"),
        ("109", "Other"),
        ("110", "Carpet"),
        ("111", "FIRE RATING"),
        ("115", "Timber Partitions"),
        ("ACCOM", "Accommodation Allowance"),
        ("Other", "Other (please Specify)"),
        ("P&G", "Preliminary and General"),
        ("P&Gs", "P&G Supervision"),
        ("P&Gt", "P&G Travel"),
        ("R/M", "Repairs and Maintenance"),
        ("Safety", "Safety Equipment"),
        ("Staff", "Staff Purchases on Company account"),
        ("Tools", "Tools"),
        ("Training", "Staff Training"),
    ]
    
    for code, desc in default_codes:
        existing_code = await db.task_codes.find_one({"code": code})
        if not existing_code:
            await db.task_codes.insert_one({"code": code, "description": desc, "created_at": datetime.now(timezone.utc)})
    
    logger.info("Task codes seeded")
    
    # Write test credentials
    memory_dir = Path(__file__).resolve().parent.parent / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    with open(memory_dir / "test_credentials.md", "w", encoding="utf-8") as f:
        f.write(f"# Test Credentials\n\n")
        f.write(f"## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n")
        f.write(f"## Auth Endpoints\n- POST /api/auth/register\n- POST /api/auth/login\n- POST /api/auth/logout\n- GET /api/auth/me\n")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Include the router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["http://localhost:3000","http://127.0.0.1:3000","http://localhost:3001","http://127.0.0.1:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)


























