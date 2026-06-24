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

# TIMESHEET MANAGER / ROOT BACKEND HEALTH ROUTES V1
@app.get("/")
async def app_root():
    return {"message": "Timesheet Manager API", "status": "operational"}

@app.get("/health")
async def app_health_check():
    return {"status": "healthy", "service": "timesheet-manager", "timestamp": datetime.now(timezone.utc).isoformat()}

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
    invited_at: Optional[str] = None
    first_login_at: Optional[str] = None
    last_login_at: Optional[str] = None
    account_status: Optional[str] = None

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
class JobNumberCreate(BaseModel):
    job_number: str
    description: Optional[str] = ""
    active: bool = True

class JobNumberResponse(BaseModel):
    id: str
    job_number: str
    description: str = ""
    active: bool = True

class TimeEntry(BaseModel):
    type: Optional[str] = "work"
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

class LLDLabourImportRow(BaseModel):
    id: Optional[str] = None
    source_row_id: Optional[str] = None
    employee_id: Optional[str] = None
    employee_name: str
    work_date: str
    day: Optional[str] = None
    start_time: str
    lunch_duration: Optional[str] = "30"
    finish_time: str
    total_hours: Optional[float] = None
    job_number: str
    task_code: str
    project_manager_id: str
    description: Optional[str] = None
    other: Optional[str] = None
    source_diary_project_id: Optional[str] = None
    source_diary_date: Optional[str] = None
    source: Optional[str] = "LLD"
    sync_status: Optional[str] = "local_only"

class LLDLabourDraftImport(BaseModel):
    source_diary_project_id: Optional[str] = None
    source_diary_date: Optional[str] = None
    rows: List[LLDLabourImportRow]

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
    reminder_day: str = "Friday"  # Day of week for weekly submission reminder
    reminder_frequency: str = "weekly"  # daily or weekly
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

def serialize_optional_datetime(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")

def serialize_user(user: dict) -> dict:
    last_login_at = user.get("last_login_at")
    account_status = user.get("account_status") or ("active" if last_login_at else "not_proven")
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "created_at": serialize_optional_datetime(user.get("created_at", datetime.now(timezone.utc))),
        "invited_at": serialize_optional_datetime(user.get("invited_at")),
        "first_login_at": serialize_optional_datetime(user.get("first_login_at")),
        "last_login_at": serialize_optional_datetime(last_login_at),
        "account_status": account_status
    }

# ==================== HEALTH ENDPOINTS ====================

@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "timesheet-manager",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register(user: UserCreate, response: Response):
    allow_public_registration = os.environ.get("ALLOW_PUBLIC_REGISTRATION", "false").strip().lower()
    if allow_public_registration not in {"1", "true", "yes", "on"}:
        raise HTTPException(
            status_code=403,
            detail="Public registration is disabled. Ask an admin to create your account."
        )

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
            "reminder_frequency": "weekly",
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
    login_now = datetime.now(timezone.utc)
    login_update = {
        "last_login_at": login_now,
        "account_status": "active"
    }
    if not db_user.get("first_login_at"):
        login_update["first_login_at"] = login_now

    await db.users.update_one({"_id": db_user["_id"]}, {"$set": login_update})
    db_user = {**db_user, **login_update}

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

# TIMESHEET / FITOUTOS TASK CODE SYNC V1
class TaskCodeSyncItem(BaseModel):
    code: str
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    smartly_department_quick_code: Optional[str] = None
    smartly_export_enabled: Optional[bool] = None


class JobTaskCodeSyncItem(BaseModel):
    job_number: str
    code: Optional[str] = None
    task_code: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = True

class TaskCodeSyncRequest(BaseModel):
    source: str = "fitoutos"
    dry_run: bool = True
    codes: List[TaskCodeSyncItem]
    job_task_codes: Optional[List[JobTaskCodeSyncItem]] = None


# ==================== TASK CODES ENDPOINTS ====================

@api_router.get("/task-codes", response_model=List[TaskCodeResponse])
async def get_task_codes():
    codes = await db.task_codes.find({}, {"_id": 1, "code": 1, "description": 1, "smartly_department_quick_code": 1, "smartly_export_enabled": 1}).to_list(1000)
    return [{"id": str(c["_id"]), "code": c["code"], "description": c["description"], "smartly_department_quick_code": c.get("smartly_department_quick_code", ""), "smartly_export_enabled": c.get("smartly_export_enabled", True)} for c in codes]

# TIMESHEET / FITOUTOS TASK CODE SYNC V1
def clean_task_code_sync_text(value):
    if value is None:
        return ""
    try:
        return str(value).strip()
    except Exception:
        return ""


@api_router.post("/task-codes/sync-from-fitoutos")
async def sync_task_codes_from_fitoutos(data: TaskCodeSyncRequest, request: Request):
    expected_token = (os.environ.get("FITOUTOS_TASK_CODE_SYNC_TOKEN") or "").strip()
    provided_token = (request.headers.get("X-FitoutOS-Sync-Token") or "").strip()

    if not expected_token:
        raise HTTPException(status_code=503, detail="FitoutOS task code sync token is not configured")

    if provided_token != expected_token:
        raise HTTPException(status_code=403, detail="Invalid FitoutOS task code sync token")

    if len(data.codes) > 1000:
        raise HTTPException(status_code=400, detail="Maximum 1000 task codes per sync")

    source_label = clean_task_code_sync_text(data.source) or "fitoutos"
    now = datetime.now(timezone.utc).isoformat()

    created = 0
    updated = 0
    unchanged = 0
    skipped = 0
    issues = []
    preview = []
    seen_codes = set()

    for index, item in enumerate(data.codes):
        code = clean_task_code_sync_text(item.code)
        code_key = code.upper()

        if not code:
            skipped += 1
            issues.append({
                "index": index,
                "reason": "Missing code"
            })
            continue

        if code_key in seen_codes:
            skipped += 1
            issues.append({
                "index": index,
                "code": code,
                "reason": "Duplicate code in sync payload"
            })
            continue

        seen_codes.add(code_key)

        description = (
            clean_task_code_sync_text(item.description)
            or clean_task_code_sync_text(item.name)
            or code
        )

        existing = await db.task_codes.find_one({"code": code})

        if existing:
            update_fields = {}

            if clean_task_code_sync_text(existing.get("description")) != description:
                update_fields["description"] = description

            if item.smartly_department_quick_code is not None:
                incoming_quick_code = clean_task_code_sync_text(item.smartly_department_quick_code)
                if clean_task_code_sync_text(existing.get("smartly_department_quick_code")) != incoming_quick_code:
                    update_fields["smartly_department_quick_code"] = incoming_quick_code

            if item.smartly_export_enabled is not None:
                incoming_export_enabled = bool(item.smartly_export_enabled)
                if bool(existing.get("smartly_export_enabled", True)) != incoming_export_enabled:
                    update_fields["smartly_export_enabled"] = incoming_export_enabled

            if update_fields:
                update_fields["updated_from_fitoutos_at"] = now
                update_fields["updated_from_fitoutos_source"] = source_label

                if not data.dry_run:
                    await db.task_codes.update_one(
                        {"_id": existing["_id"]},
                        {"$set": update_fields}
                    )

                updated += 1
                action = "update"
            else:
                unchanged += 1
                action = "unchanged"

            preview.append({
                "code": code,
                "description": description,
                "action": action
            })
            continue

        new_doc = {
            "code": code,
            "description": description,
            "smartly_department_quick_code": clean_task_code_sync_text(item.smartly_department_quick_code),
            "smartly_export_enabled": bool(item.smartly_export_enabled) if item.smartly_export_enabled is not None else False,
            "created_by": "fitoutos-sync",
            "created_at": datetime.now(timezone.utc),
            "created_from_fitoutos_at": now,
            "created_from_fitoutos_source": source_label
        }

        if not data.dry_run:
            await db.task_codes.insert_one(new_doc)

        created += 1
        preview.append({
            "code": code,
            "description": description,
            "action": "create",
            "smartly_export_enabled": new_doc["smartly_export_enabled"]
        })

    # TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
    job_mapping_created = 0
    job_mapping_updated = 0
    job_mapping_unchanged = 0
    job_mapping_skipped = 0
    job_mapping_preview = []
    seen_job_code_pairs = set()
    job_task_code_items = data.job_task_codes or []

    if len(job_task_code_items) > 3000:
        raise HTTPException(status_code=400, detail="Maximum 3000 job/task code mappings per sync")

    for index, item in enumerate(job_task_code_items):
        job_number = clean_task_code_sync_text(item.job_number)
        code = clean_task_code_sync_text(item.code or item.task_code)
        code_key = code.upper()
        job_key = job_number.upper()
        pair_key = f"{job_key}:{code_key}"

        if not job_number or not code:
            job_mapping_skipped += 1
            issues.append({
                "index": index,
                "job_number": job_number,
                "code": code,
                "reason": "Missing job_number or code in job task mapping"
            })
            continue

        if pair_key in seen_job_code_pairs:
            job_mapping_skipped += 1
            issues.append({
                "index": index,
                "job_number": job_number,
                "code": code,
                "reason": "Duplicate job/task mapping in sync payload"
            })
            continue

        seen_job_code_pairs.add(pair_key)

        description = clean_task_code_sync_text(item.description)
        active = bool(item.active) if item.active is not None else True

        existing_mapping = await db.job_task_code_mappings.find_one({
            "job_number": job_number,
            "code": code
        })

        if existing_mapping:
            update_fields = {}

            if clean_task_code_sync_text(existing_mapping.get("description")) != description:
                update_fields["description"] = description

            if bool(existing_mapping.get("active", True)) != active:
                update_fields["active"] = active

            if update_fields:
                update_fields["updated_from_fitoutos_at"] = now
                update_fields["updated_from_fitoutos_source"] = source_label

                if not data.dry_run:
                    await db.job_task_code_mappings.update_one(
                        {"_id": existing_mapping["_id"]},
                        {"$set": update_fields}
                    )

                job_mapping_updated += 1
                action = "update"
            else:
                job_mapping_unchanged += 1
                action = "unchanged"
        else:
            new_mapping_doc = {
                "job_number": job_number,
                "code": code,
                "description": description,
                "active": active,
                "created_by": "fitoutos-sync",
                "created_at": datetime.now(timezone.utc),
                "created_from_fitoutos_at": now,
                "created_from_fitoutos_source": source_label
            }

            if not data.dry_run:
                await db.job_task_code_mappings.insert_one(new_mapping_doc)

            job_mapping_created += 1
            action = "create"

        job_mapping_preview.append({
            "job_number": job_number,
            "code": code,
            "description": description,
            "active": active,
            "action": action
        })

    return {
        "source": source_label,
        "dry_run": data.dry_run,
        "received": len(data.codes),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
        "new_codes_default_smartly_export_enabled": False,
        "job_mapping_created": job_mapping_created,
        "job_mapping_updated": job_mapping_updated,
        "job_mapping_unchanged": job_mapping_unchanged,
        "job_mapping_skipped": job_mapping_skipped,
        "job_mapping_preview": job_mapping_preview[:200],
        "issues": issues[:100],
        "preview": preview[:200]
    }


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

# ==================== JOB NUMBERS ENDPOINTS ====================

@api_router.get("/job-numbers", response_model=List[JobNumberResponse])
async def get_job_numbers():
    jobs = await db.job_numbers.find({}, {"_id": 1, "job_number": 1, "description": 1, "active": 1}).sort("job_number", 1).to_list(1000)
    return [{"id": str(j["_id"]), "job_number": j["job_number"], "description": j.get("description", ""), "active": j.get("active", True)} for j in jobs]

@api_router.post("/job-numbers", response_model=JobNumberResponse)
async def create_job_number(job: JobNumberCreate, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    job_number = (job.job_number or "").strip()
    if not job_number:
        raise HTTPException(status_code=400, detail="Job number is required")

    existing = await db.job_numbers.find_one({"job_number": job_number})
    if existing:
        raise HTTPException(status_code=400, detail="Job number already exists")

    description = (job.description or "").strip()
    active = bool(job.active)
    doc = {
        "job_number": job_number,
        "description": description,
        "active": active,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.job_numbers.insert_one(doc)
    return {"id": str(result.inserted_id), "job_number": job_number, "description": description, "active": active}

@api_router.delete("/job-numbers/{job_id}")
async def delete_job_number(job_id: str, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    result = await db.job_numbers.delete_one({"_id": ObjectId(job_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Job number not found")
    return {"message": "Job number deleted"}

LEAVE_ENTRY_TYPES = {"public_holiday", "annual_leave", "sick"}
UNPAID_ENTRY_TYPES = {"unpaid_day_off"}

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
    leave_types = LEAVE_ENTRY_TYPES
    unpaid_types = UNPAID_ENTRY_TYPES

    def norm_type(value):
        raw = str(value or "work").strip().lower().replace("-", "_").replace(" ", "_")
        if "public" in raw and "holiday" in raw:
            return "public_holiday"
        if ("ann" in raw or "annual" in raw) and "leave" in raw:
            return "annual_leave"
        if "sick" in raw:
            return "sick"
        if "unpaid" in raw:
            return "unpaid_day_off"
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

            if entry_type in unpaid_types:
                if total_hours > 0:
                    raise HTTPException(status_code=400, detail=f"Unpaid day off must be 0 hours on {day_name}")
                has_any_entry = True
                continue

            work_started_fields = [(field, label) for field, label in required_work_fields if field != "lunch_duration"]
            row_has_any_value = any(has_value(entry.get(field)) for field, _ in work_started_fields) or total_hours > 0
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

@api_router.post("/timesheets/lld-draft-import")
async def import_lld_labour_drafts(payload: LLDLabourDraftImport, request: Request):
    """Import LLD diary labour rows as review-only Timesheet records.

    This endpoint creates submitted/pending-review timesheets only.
    It does not PM approve, admin approve, or export payroll records.
    """
    configured_import_token = (os.environ.get("LLS_LLD_IMPORT_TOKEN") or "").strip()
    supplied_import_token = (request.headers.get("X-LLS-Import-Token") or "").strip()

    if configured_import_token and supplied_import_token and secrets.compare_digest(configured_import_token, supplied_import_token):
        actor = {
            "id": "service:lld",
            "email": "lld-import",
            "role": "integration"
        }
        auth_mode = "integration_token"
    else:
        actor = await get_current_user(request)
        auth_mode = "user_token"
        if actor.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

    if not payload.rows:
        raise HTTPException(status_code=400, detail="At least one LLD labour row is required")

    def clean_text(value, fallback=""):
        if value is None:
            return fallback
        text = str(value).strip()
        return text if text else fallback

    def parse_work_date(value):
        text = clean_text(value)
        if not text:
            return None
        try:
            return datetime.fromisoformat(text).date()
        except Exception:
            return None

    def minutes_from_time(value):
        text = clean_text(value).lower().replace(".", "")
        if not text:
            return None

        suffix = None
        if text.endswith("am"):
            suffix = "am"
            text = text[:-2].strip()
        elif text.endswith("pm"):
            suffix = "pm"
            text = text[:-2].strip()

        if ":" not in text:
            return None

        try:
            hour_text, minute_text = text.split(":", 1)
            hour = int(hour_text)
            minute = int(minute_text[:2])
        except Exception:
            return None

        if suffix == "pm" and hour < 12:
            hour += 12
        if suffix == "am" and hour == 12:
            hour = 0

        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            return None

        return (hour * 60) + minute

    def calculate_hours(start_time, finish_time, lunch_duration):
        start_minutes = minutes_from_time(start_time)
        finish_minutes = minutes_from_time(finish_time)
        if start_minutes is None or finish_minutes is None:
            return None
        if finish_minutes <= start_minutes:
            return None
        try:
            lunch_minutes = float(clean_text(lunch_duration, "0"))
        except Exception:
            lunch_minutes = 0
        return max(0, round(((finish_minutes - start_minutes) - lunch_minutes) / 60, 2))

    days_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    groups = {}
    issues = []
    skipped = []
    seen_import_keys = set()
    import_batch_id = str(ObjectId())
    imported_at = datetime.now(timezone.utc)

    for index, row in enumerate(payload.rows):
        row_number = index + 1
        employee_name = clean_text(row.employee_name)
        employee_id = clean_text(row.employee_id)
        work_date_obj = parse_work_date(row.work_date)
        start_time = clean_text(row.start_time)
        finish_time = clean_text(row.finish_time)
        lunch_duration = clean_text(row.lunch_duration, "30")
        job_number = clean_text(row.job_number)
        task_code = clean_text(row.task_code)
        project_manager_id = clean_text(row.project_manager_id)
        description = clean_text(row.description or row.other)
        source_diary_project_id = clean_text(row.source_diary_project_id or payload.source_diary_project_id)
        source_diary_date = clean_text(row.source_diary_date or payload.source_diary_date or row.work_date)
        source_row_id = clean_text(row.source_row_id or row.id)

        required_missing = []
        if not employee_name:
            required_missing.append("employee_name")
        if not work_date_obj:
            required_missing.append("work_date")
        if not start_time:
            required_missing.append("start_time")
        if not finish_time:
            required_missing.append("finish_time")
        if not job_number:
            required_missing.append("job_number")
        if not task_code:
            required_missing.append("task_code")
        if not project_manager_id:
            required_missing.append("project_manager_id")

        if required_missing:
            issues.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": f"Missing required fields: {', '.join(required_missing)}"
            })
            continue

        total_hours = row.total_hours
        if total_hours is None or float(total_hours or 0) <= 0:
            total_hours = calculate_hours(start_time, finish_time, lunch_duration)

        try:
            total_hours = float(total_hours or 0)
        except Exception:
            total_hours = 0

        if total_hours <= 0:
            issues.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": "Hours must be greater than zero and finish time must be after start time"
            })
            continue

        user_doc = None
        if employee_id:
            try:
                user_doc = await db.users.find_one({"_id": ObjectId(employee_id), "is_pro": {"$ne": True}})
            except Exception:
                user_doc = None

        if not user_doc:
            user_doc = await db.users.find_one({
                "name": employee_name,
                "role": {"$in": ["employee", "project_manager", "admin"]},
                "is_pro": {"$ne": True}
            })

        if not user_doc:
            issues.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": "No matching Timesheet user found for employee"
            })
            continue

        task_doc = await db.task_codes.find_one({"code": task_code})
        if not task_doc:
            issues.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": f"Unknown task code: {task_code}"
            })
            continue

        try:
            pm_doc = await db.project_managers.find_one({"_id": ObjectId(project_manager_id)})
        except Exception:
            pm_doc = None

        if not pm_doc:
            issues.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": "Unknown project manager"
            })
            continue

        day_name = clean_text(row.day) or work_date_obj.strftime("%A")
        if day_name not in days_order:
            day_name = work_date_obj.strftime("%A")

        week_ending = (work_date_obj + timedelta(days=(6 - work_date_obj.weekday()))).isoformat()
        raw_source_id = source_row_id or f"{employee_name}:{work_date_obj.isoformat()}:{start_time}:{finish_time}:{job_number}:{task_code}:{project_manager_id}"
        source_import_key = f"lld:{source_diary_project_id}:{source_diary_date}:{raw_source_id}"

        if source_import_key in seen_import_keys:
            skipped.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": "Duplicate row in import payload",
                "source_import_key": source_import_key
            })
            continue

        existing_import = await db.timesheets.find_one(
            {"days.entries.source_import_key": source_import_key},
            {"_id": 1, "employee_name": 1, "week_ending": 1}
        )
        if existing_import:
            skipped.append({
                "row_number": row_number,
                "employee_name": employee_name,
                "reason": "LLD row was already imported",
                "existing_timesheet_id": str(existing_import.get("_id")),
                "source_import_key": source_import_key
            })
            continue

        seen_import_keys.add(source_import_key)

        user_id = str(user_doc["_id"])
        group_key = f"{user_id}:{week_ending}"

        if group_key not in groups:
            groups[group_key] = {
                "user_id": user_id,
                "employee_name": clean_text(user_doc.get("name"), employee_name),
                "week_ending": week_ending,
                "days": {day: [] for day in days_order},
                "pm_ids": set(),
                "source_import_keys": []
            }

        entry = {
            "type": "work",
            "start_time": start_time,
            "lunch_duration": lunch_duration,
            "finish_time": finish_time,
            "total_hours": total_hours,
            "job_number": job_number,
            "task_code": task_code,
            "project_manager_id": project_manager_id,
            "description": description,
            "other": description,
            "source": "LLD",
            "source_type": "lld_diary_labour_import",
            "source_row_id": raw_source_id,
            "source_import_key": source_import_key,
            "source_diary_project_id": source_diary_project_id,
            "source_diary_date": source_diary_date,
            "work_date": work_date_obj.isoformat(),
            "import_batch_id": import_batch_id,
            "imported_at": imported_at.isoformat()
        }

        groups[group_key]["days"][day_name].append(entry)
        groups[group_key]["pm_ids"].add(project_manager_id)
        groups[group_key]["source_import_keys"].append(source_import_key)

    created_timesheets = []
    created_entry_count = 0

    for group in groups.values():
        days_data = [
            {"day": day, "entries": group["days"][day]}
            for day in days_order
        ]
        total_hours = round(
            sum(float(entry.get("total_hours", 0) or 0) for day in days_data for entry in day["entries"]),
            2
        )

        validate_timesheet_entries(days_data, require_signature=False, employee_signature=None)

        doc = {
            "user_id": group["user_id"],
            "employee_name": group["employee_name"],
            "week_ending": group["week_ending"],
            "period_type": "weekly",
            "days": days_data,
            "messages": f"Imported from LLD diary labour rows. Import batch {import_batch_id}. Review before approval/export.",
            "nights_away": 0,
            "total_hours": total_hours,
            "employee_signature": None,
            "status": "submitted",
            "pm_ids": sorted(group["pm_ids"]),
            "pm_signatures": [],
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
            "source": "LLD",
            "source_type": "lld_diary_labour_import",
            "import_status": "pending_review",
            "import_batch_id": import_batch_id,
            "source_import_keys": group["source_import_keys"],
            "imported_by": actor.get("id"),
            "imported_by_email": actor.get("email"),
            "import_auth_mode": auth_mode,
            "created_at": imported_at,
            "updated_at": imported_at
        }

        result = await db.timesheets.insert_one(doc)
        created_timesheets.append({
            "id": str(result.inserted_id),
            "employee_name": group["employee_name"],
            "week_ending": group["week_ending"],
            "total_hours": total_hours,
            "status": "submitted",
            "import_status": "pending_review"
        })
        created_entry_count += sum(len(day["entries"]) for day in days_data)

    return {
        "status": "imported_for_review",
        "message": "LLD labour rows imported as submitted Timesheet records for PM/admin review. No records were approved.",
        "import_batch_id": import_batch_id,
        "created_timesheet_count": len(created_timesheets),
        "created_entry_count": created_entry_count,
        "skipped_count": len(skipped),
        "issue_count": len(issues),
        "created_timesheets": created_timesheets,
        "skipped": skipped,
        "issues": issues,
        "honest_status": {
            "creates_timesheets": True,
            "status_created": "submitted",
            "pm_approved": False,
            "admin_approved": False,
            "payroll_export_ready": False
        }
    }
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
                        "reason": f"Recorded on timesheet but excluded from Smartly work-hours CSV: {entry_type.replace('_', ' ').title()}",
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

@api_router.get("/timesheets/fitoutos-export.json")
async def export_fitoutos_labour_json(
    request: Request,
    status: Optional[str] = "approved",
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
        "total_hours": 1,
        "created_at": 1
    }).sort("week_ending", -1).to_list(5000)

    rows = []
    issues = []
    skipped = []

    for timesheet in timesheets:
        timesheet_id = str(timesheet.get("_id", ""))
        employee_name = _clean_export_text(timesheet.get("employee_name"))
        week_value = _clean_export_text(timesheet.get("week_ending"))
        timesheet_status = _clean_export_text(timesheet.get("status"))
        timesheet_messages = _clean_export_text(timesheet.get("messages"))

        for day_index, day in enumerate(timesheet.get("days", []) or []):
            day_name = _clean_export_text(day.get("day"))
            work_date = _resolve_work_date(week_value, day_name)

            for entry_index, entry in enumerate(day.get("entries", []) or []):
                entry_type = _clean_export_text(entry.get("type") or "work") or "work"

                try:
                    hours = float(entry.get("total_hours", 0) or 0)
                except Exception:
                    hours = 0.0

                job_number = _clean_export_text(entry.get("job_number"))
                task_code = _clean_export_text(entry.get("task_code"))
                description = _clean_export_text(entry.get("description") or entry.get("other"))
                row_ref = {
                    "timesheet_id": timesheet_id,
                    "employee_name": employee_name,
                    "week_ending": week_value,
                    "day": day_name,
                    "entry_index": entry_index
                }

                if entry_type != "work":
                    skipped.append({**row_ref, "reason": f"Non-work row skipped: {entry_type}"})
                    continue

                if hours <= 0:
                    skipped.append({**row_ref, "reason": "Zero or missing hours"})
                    continue

                row_issues = []
                if not job_number:
                    row_issues.append("Missing job_number")
                if not task_code:
                    row_issues.append("Missing task_code")
                if not work_date:
                    row_issues.append("Could not resolve work_date from week_ending/day")

                if row_issues:
                    issues.append({**row_ref, "reason": "; ".join(row_issues)})
                    continue

                source_id = f"timesheet-manager:{timesheet_id}:{day_name}:{entry_index}:{job_number}:{task_code}"

                rows.append({
                    "source": "timesheet-manager-fitoutos-export",
                    "source_id": source_id,
                    "timesheet_id": timesheet_id,
                    "employee_name": employee_name,
                    "week_ending": week_value,
                    "status": timesheet_status,
                    "day": day_name,
                    "date": work_date,
                    "work_date": work_date,
                    "job_number": job_number,
                    "task_code": task_code,
                    "hours": hours,
                    "actual_hours": hours,
                    "notes": description or timesheet_messages
                })

    return {
        "source": "timesheet-manager",
        "target": "fitoutos",
        "format": "fitoutos_labour_import_v1",
        "filters": {
            "status": status or "approved",
            "week_ending": week_ending or "all"
        },
        "row_count": len(rows),
        "issue_count": len(issues),
        "skipped_count": len(skipped),
        "rows": rows,
        "issues": issues,
        "skipped": skipped
    }

@api_router.get("/timesheets/reference-options")
async def get_timesheet_reference_options(request: Request):
    """Read-only reference options for Timesheet-compatible labour capture.

    Intended first consumer: LLD Daily Labour Rows.
    This endpoint does not create or update timesheets.
    """
    configured_integration_token = (os.environ.get("LLS_REFERENCE_OPTIONS_TOKEN") or "").strip()
    supplied_integration_token = (request.headers.get("X-LLS-Reference-Token") or "").strip()

    if configured_integration_token and supplied_integration_token and secrets.compare_digest(configured_integration_token, supplied_integration_token):
        user = {
            "id": "service:lld",
            "email": "lld-integration",
            "role": "integration"
        }
        auth_mode = "integration_token"
    else:
        user = await get_current_user(request)
        auth_mode = "user_token"

    def as_text(value, fallback=""):
        if value is None:
            return fallback
        try:
            clean = str(value).strip()
            return clean if clean else fallback
        except Exception:
            return fallback

    def as_bool(value, fallback=True):
        if value is None:
            return fallback
        try:
            return bool(value)
        except Exception:
            return fallback

    # TIMESHEET / CLEAN TASK CODE LABELS V1
    def clean_reference_label_text(value):
        text = as_text(value)
        if not text:
            return ""
        replacements = {
            "Ã¢â‚¬â€œ": "-",
            "Ã¢â‚¬â€": "-",
            "â€“": "-",
            "â€”": "-",
            "Ã¢â‚¬â„¢": "'",
            "Ã¢â‚¬Ëœ": "'",
            "Ã¢â‚¬Å“": '"',
            "Ã¢â‚¬": '"',
            "Ã‚": ""
        }
        for bad, good in replacements.items():
            text = text.replace(bad, good)
        text = " ".join(text.split())
        return text.strip(" -")

    def strip_task_code_prefix(task_code, description):
        code = clean_reference_label_text(task_code)
        desc = clean_reference_label_text(description)
        if code and desc:
            desc_lower = desc.lower()
            code_lower = code.lower()
            if desc_lower == code_lower:
                return ""
            if desc_lower.startswith(code_lower + " -"):
                return desc[len(code):].strip(" -")
            if desc_lower.startswith(code_lower + "-"):
                return desc[len(code):].strip(" -")
            if desc_lower.startswith(code_lower + " "):
                return desc[len(code):].strip(" -")
        return desc

    def make_task_code_label(task_code, description):
        code = clean_reference_label_text(task_code)
        desc = strip_task_code_prefix(task_code, description)
        if code and desc:
            return f"{code} - {desc}"
        return code or desc

    def make_label(*parts):
        clean_parts = [clean_reference_label_text(part) for part in parts if clean_reference_label_text(part)]
        return " - ".join(clean_parts)

    employee_options = []
    pm_options = []
    task_code_options = []
    # TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
    task_code_by_code = {}
    # TIMESHEET / CLEAN TASK CODE DESCRIPTION VALUES V1
    task_codes_by_job = {}
    source_warnings = []

    try:
        users = await db.users.find(
            {},
            {
                "_id": 1,
                "email": 1,
                "name": 1,
                "role": 1,
                "is_pro": 1
            }
        ).to_list(1000)

        allowed_roles = {"employee", "project_manager", "admin"}
        for item in users:
            role = as_text(item.get("role"), "employee")
            if role not in allowed_roles:
                continue
            if item.get("is_pro") is True:
                continue

            name = as_text(item.get("name")) or as_text(item.get("email"), "Unnamed user")
            employee_options.append({
                "id": str(item.get("_id", "")),
                "name": name,
                "email": as_text(item.get("email")),
                "role": role,
                "label": name,
                "value": name,
                "is_employee": True
            })
    except Exception as exc:
        source_warnings.append(f"users unavailable: {str(exc)}")

    try:
        project_managers = await db.project_managers.find(
            {},
            {
                "_id": 1,
                "initials": 1,
                "name": 1,
                "email": 1
            }
        ).to_list(1000)

        for pm in project_managers:
            pm_id = str(pm.get("_id", ""))
            pm_name = as_text(pm.get("name")) or as_text(pm.get("initials"), "Unnamed PM")
            pm_options.append({
                "id": pm_id,
                "initials": as_text(pm.get("initials")),
                "name": as_text(pm.get("name")),
                "email": as_text(pm.get("email")),
                "label": pm_name,
                "value": pm_id
            })
    except Exception as exc:
        source_warnings.append(f"project_managers unavailable: {str(exc)}")

    try:
        task_codes = await db.task_codes.find(
            {},
            {
                "_id": 1,
                "code": 1,
                "description": 1,
                "smartly_department_quick_code": 1,
                "smartly_export_enabled": 1
            }
        ).to_list(1000)

        for code in task_codes:
            task_code = as_text(code.get("code"))
            description = as_text(code.get("description"))
            option = {
                "id": str(code.get("_id", "")),
                "code": task_code,
                "description": strip_task_code_prefix(task_code, description),
                "smartly_department_quick_code": as_text(code.get("smartly_department_quick_code")),
                "smartly_export_enabled": as_bool(code.get("smartly_export_enabled"), True),
                "label": make_task_code_label(task_code, description) or task_code,
                "value": task_code
            }
            task_code_options.append(option)
            if task_code:
                task_code_by_code[task_code.upper()] = option
    except Exception as exc:
        source_warnings.append(f"task_codes unavailable: {str(exc)}")

    # TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
    try:
        job_task_mappings = await db.job_task_code_mappings.find(
            {"active": {"$ne": False}},
            {
                "_id": 1,
                "job_number": 1,
                "code": 1,
                "description": 1,
                "active": 1
            }
        ).to_list(5000)

        for mapping in job_task_mappings:
            job_number = as_text(mapping.get("job_number"))
            task_code = as_text(mapping.get("code"))
            if not job_number or not task_code:
                continue

            source_option = task_code_by_code.get(task_code.upper(), {})
            description = as_text(mapping.get("description")) or as_text(source_option.get("description"))
            option = {
                "id": str(mapping.get("_id", "")),
                "job_number": job_number,
                "code": task_code,
                "description": strip_task_code_prefix(task_code, description),
                "smartly_department_quick_code": as_text(source_option.get("smartly_department_quick_code")),
                "smartly_export_enabled": as_bool(source_option.get("smartly_export_enabled"), True),
                "label": make_task_code_label(task_code, description) or task_code,
                "value": task_code
            }

            task_codes_by_job.setdefault(job_number, []).append(option)
            job_number_upper = job_number.upper()
            if job_number_upper != job_number:
                task_codes_by_job.setdefault(job_number_upper, []).append(option)
    except Exception as exc:
        source_warnings.append(f"job_task_code_mappings unavailable: {str(exc)}")

    for job_number in list(task_codes_by_job.keys()):
        task_codes_by_job[job_number].sort(key=lambda row: (row.get("code") or "").lower())

    employee_options.sort(key=lambda row: ((row.get("name") or "").lower(), (row.get("email") or "").lower()))
    pm_options.sort(key=lambda row: ((row.get("name") or "").lower(), (row.get("initials") or "").lower()))
    task_code_options.sort(key=lambda row: (row.get("code") or "").lower())

    return {
        "source": "Timesheet Manager",
        "purpose": "LLD labour dropdown/reference options",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "auth_mode": auth_mode,
        "requested_by": {
            "id": as_text(user.get("id")),
            "email": as_text(user.get("email")),
            "role": as_text(user.get("role"))
        },
        "field_names": {
            "employee": "employee_name",
            "start": "start_time",
            "finish": "finish_time",
            "lunch": "lunch_duration",
            "hours": "total_hours",
            "job": "job_number",
            "task": "task_code",
            "project_manager": "project_manager_id",
            "description": "description"
        },
        "defaults": {
            "period_type": "weekly",
            "entry_type": "work",
            "lunch_duration": "30",
            "source": "LLD",
            "sync_status": "local_only"
        },
        "lunch_options": [
            {"label": "No lunch", "value": "0", "minutes": 0},
            {"label": "30m", "value": "30", "minutes": 30},
            {"label": "60m", "value": "60", "minutes": 60}
        ],
        "employees": employee_options,
        "project_managers": pm_options,
        "task_codes": task_code_options,
        "task_codes_by_job": task_codes_by_job,
        "counts": {
            "employees": len(employee_options),
            "project_managers": len(pm_options),
            "task_codes": len(task_code_options),
            "job_task_code_mappings": sum(len(items) for items in task_codes_by_job.values())
        },
        "source_warnings": source_warnings,
        "honest_status": {
            "read_only": True,
            "creates_timesheets": False,
            "approves_timesheets": False,
            "fallback_safe": True,
            "intended_next_step": "Wire LLD labour dropdowns to these options, then add LLD to Timesheet draft import."
        }
    }

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

    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")

    if timesheet.get("status") != "rejected":
        raise HTTPException(
            status_code=400,
            detail="Only rejected, unprocessed timesheets can be deleted. Processed/exported timesheets need an adjustment instead."
        )

    processed_markers = [
        "pm_approved",
        "admin_approved",
        "payroll_export_ready",
        "smartly_exported",
        "exported",
        "processed",
        "fitoutos_synced",
        "fitoutos_pushed",
        "actuals_synced",
        "synced_to_fitoutos",
    ]

    if any(bool(timesheet.get(marker)) for marker in processed_markers):
        raise HTTPException(
            status_code=400,
            detail="Only rejected, unprocessed timesheets can be deleted. Processed/exported timesheets need an adjustment instead."
        )

    await db.timesheets.delete_one({"_id": ObjectId(timesheet_id)})
    return {"message": "Rejected unprocessed timesheet deleted"}

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
            # TIMESHEET MANAGER / FITOUTOS ADMIN APPROVAL SYNC ENV GUARD V3
            # Production-safe behaviour:
            # - no hardcoded localhost target
            # - sync is skipped cleanly unless FITOUTOS_LABOUR_IMPORT_URL is configured
            # - approval response is never blocked by FitoutOS availability
            fitoutos_import_url = (os.environ.get("FITOUTOS_LABOUR_IMPORT_URL") or "").strip()
            fitoutos_import_token = (os.environ.get("FITOUTOS_LABOUR_IMPORT_TOKEN") or "").strip()

            if not fitoutos_import_url:
                print("FITOUT SYNC SKIPPED: FITOUTOS_LABOUR_IMPORT_URL not configured")
            else:
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
                            "trade": entry.get("trade"),
                            "source_id": entry.get("id"),
                            "date": work_date or str(week_ending_value),
                            "hours": hours
                        })

                print("FITOUT SYNC ROW COUNT:", len(rows))

                if rows:
                    payload = json.dumps({"rows": rows}).encode("utf-8")
                    headers = {
                        "Content-Type": "application/json"
                    }

                    if fitoutos_import_token:
                        headers["Authorization"] = f"Bearer {fitoutos_import_token}"

                    req = urllib.request.Request(
                        fitoutos_import_url,
                        data=payload,
                        headers=headers,
                        method="POST"
                    )
                    print("FITOUT SYNC POSTING:", fitoutos_import_url)
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
    stored_settings = (db_user or {}).get("notification_settings") or {}

    return {
        "reminder_time": stored_settings.get("reminder_time", "17:00"),
        "reminder_day": stored_settings.get("reminder_day", "Friday"),
        "reminder_frequency": stored_settings.get("reminder_frequency", "weekly"),
        "enabled": stored_settings.get("enabled", True)
    }

@api_router.put("/notification-settings")
async def update_notification_settings(settings: NotificationSettingsUpdate, request: Request):
    user = await get_current_user(request)
    payload = settings.model_dump()

    if payload.get("reminder_frequency") not in ["daily", "weekly"]:
        payload["reminder_frequency"] = "weekly"

    if payload.get("reminder_day") not in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]:
        payload["reminder_day"] = "Friday"

    await db.users.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {"notification_settings": payload}}
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
            "invited_at": 1,
            "first_login_at": 1,
            "last_login_at": 1,
            "account_status": 1,
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
        invited_at = u.get("invited_at", "")
        first_login_at = u.get("first_login_at", "")
        last_login_at = u.get("last_login_at", "")
        account_status = u.get("account_status") or ("active" if last_login_at else "not_proven")
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
            "created_at": serialize_optional_datetime(created_at),
            "invited_at": serialize_optional_datetime(invited_at),
            "first_login_at": serialize_optional_datetime(first_login_at),
            "last_login_at": serialize_optional_datetime(last_login_at),
            "account_status": account_status,
        })

    return safe_users

@api_router.post("/users", response_model=UserResponse)
async def create_user(user_create: UserCreate, request: Request):
    current_user = await get_current_user(request)
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    email = user_create.email.lower().strip()
    name = user_create.name.strip()
    password = user_create.password

    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    if not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="Temporary password must be at least 8 characters")

    role = user_create.role if user_create.role in ["employee", "project_manager", "admin"] else "employee"

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    created_now = datetime.now(timezone.utc)
    user_doc = {
        "email": email,
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "created_at": created_now,
        "invited_at": created_now,
        "first_login_at": None,
        "last_login_at": None,
        "account_status": "invited",
        "notification_settings": {
            "reminder_time": "17:00",
            "reminder_day": "Friday",
            "reminder_frequency": "weekly",
            "enabled": True
        },
        "smartly_employee_code": "",
        "smartly_pay_group": "",
        "payroll_treatment": "payroll_employee",
        "smartly_costing_mode": "define_now",
        "smartly_has_standard_hours": True
    }

    result = await db.users.insert_one(user_doc)

    return {
        "id": str(result.inserted_id),
        "email": user_doc["email"],
        "name": user_doc["name"],
        "role": user_doc["role"],
        "smartly_employee_code": user_doc["smartly_employee_code"],
        "smartly_pay_group": user_doc["smartly_pay_group"],
        "payroll_treatment": user_doc["payroll_treatment"],
        "smartly_costing_mode": user_doc["smartly_costing_mode"],
        "smartly_has_standard_hours": user_doc["smartly_has_standard_hours"],
        "created_at": user_doc["created_at"].isoformat(),
        "invited_at": user_doc["invited_at"].isoformat(),
        "first_login_at": "",
        "last_login_at": "",
        "account_status": user_doc["account_status"]
    }

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
    # TIMESHEET / JOB-SPECIFIC TASK CODE FILTER V1
    await db.job_task_code_mappings.create_index([("job_number", 1), ("code", 1)], unique=True)
    await db.project_managers.create_index("initials", unique=True)
    await db.job_numbers.create_index("job_number", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.timesheets.create_index("user_id")
    await db.timesheets.create_index("status")

    # Seed / repair configured admin
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    admin_name = os.environ.get("ADMIN_NAME", "Admin").strip() or "Admin"

    if admin_email and admin_password:
        existing = await db.users.find_one({"email": admin_email})

        if existing is None:
            hashed = hash_password(admin_password)
            await db.users.insert_one({
                "email": admin_email,
                "password_hash": hashed,
                "name": admin_name,
                "role": "admin",
                "created_at": datetime.now(timezone.utc),
                "notification_settings": {"reminder_time": "17:00", "reminder_day": "Friday", "reminder_frequency": "weekly", "enabled": True}
            })
            logger.info(f"Configured admin user created: {admin_email}")
        else:
            update_data = {
                "email": admin_email,
                "name": existing.get("name") or admin_name,
                "role": "admin",
            }

            if not existing.get("password_hash") or not verify_password(admin_password, existing["password_hash"]):
                update_data["password_hash"] = hash_password(admin_password)

            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": update_data}
            )
            logger.info(f"Configured admin user repaired: {admin_email}")

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

    # Do not write credentials to disk.
    # Admin credentials are managed via environment variables only.

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Include the router
app.include_router(api_router)

# CORS
def parse_cors_origins() -> list[str]:
    defaults = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

    configured = []

    cors_origins = os.environ.get("CORS_ORIGINS", "")
    if cors_origins:
        configured.extend(
            origin.strip()
            for origin in cors_origins.split(",")
            if origin.strip() and origin.strip() != "*"
        )

    frontend_url = os.environ.get("FRONTEND_URL", "").strip()
    if frontend_url and frontend_url != "*":
        configured.append(frontend_url)

    seen = set()
    origins = []

    for origin in [*defaults, *configured]:
        if origin not in seen:
            origins.append(origin)
            seen.add(origin)

    return origins

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=parse_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


