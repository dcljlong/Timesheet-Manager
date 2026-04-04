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
import secrets
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
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

class TaskCodeResponse(BaseModel):
    id: str
    code: str
    description: str

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
    job_number: Optional[str] = None
    task_code: Optional[str] = None
    project_manager_id: Optional[str] = None
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
    
    access_token = create_access_token(user_id, email, user_doc["role"])
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
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
    
    if not verify_password(user.password, db_user["password_hash"]):
        await increment_login_attempts(identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Clear failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})
    
    user_id = str(db_user["_id"])
    access_token = create_access_token(user_id, email, db_user["role"])
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    
    return serialize_user(db_user)

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
    codes = await db.task_codes.find({}, {"_id": 1, "code": 1, "description": 1}).to_list(1000)
    return [{"id": str(c["_id"]), "code": c["code"], "description": c["description"]} for c in codes]

@api_router.post("/task-codes", response_model=TaskCodeResponse)
async def create_task_code(task_code: TaskCodeCreate, request: Request):
    user = await get_current_user(request)
    existing = await db.task_codes.find_one({"code": task_code.code})
    if existing:
        raise HTTPException(status_code=400, detail="Task code already exists")
    
    doc = {"code": task_code.code, "description": task_code.description, "created_by": user["id"], "created_at": datetime.now(timezone.utc)}
    result = await db.task_codes.insert_one(doc)
    return {"id": str(result.inserted_id), "code": task_code.code, "description": task_code.description}

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

# ==================== TIMESHEET ENDPOINTS ====================

@api_router.post("/timesheets")
async def create_timesheet(timesheet: TimesheetCreate, request: Request):
    user = await get_current_user(request)
    
    # Determine which PM(s) are involved
    pm_ids = set()
    for day in timesheet.days:
        for entry in day.entries:
            if entry.project_manager_id:
                pm_ids.add(entry.project_manager_id)
    
    doc = {
        "user_id": user["id"],
        "employee_name": timesheet.employee_name,
        "week_ending": timesheet.week_ending,
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
    
    timesheets = await db.timesheets.find(query, {"_id": 1, "user_id": 1, "employee_name": 1, "week_ending": 1, "period_type": 1, "total_hours": 1, "status": 1, "pm_approved": 1, "admin_approved": 1, "created_at": 1}).sort("created_at", -1).to_list(1000)
    
    return [{
        "id": str(t["_id"]),
        "user_id": t["user_id"],
        "employee_name": t["employee_name"],
        "week_ending": t["week_ending"],
        "period_type": t["period_type"],
        "total_hours": t["total_hours"],
        "status": t["status"],
        "pm_approved": t.get("pm_approved", False),
        "admin_approved": t.get("admin_approved", False),
        "created_at": t["created_at"].isoformat() if isinstance(t["created_at"], datetime) else str(t["created_at"])
    } for t in timesheets]

@api_router.get("/timesheets/{timesheet_id}")
async def get_timesheet(timesheet_id: str, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    # Check access
    if user["role"] == "employee" and timesheet["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return {
        "id": str(timesheet["_id"]),
        "user_id": timesheet["user_id"],
        "employee_name": timesheet["employee_name"],
        "week_ending": timesheet["week_ending"],
        "period_type": timesheet["period_type"],
        "days": timesheet["days"],
        "messages": timesheet.get("messages"),
        "nights_away": timesheet.get("nights_away", 0),
        "total_hours": timesheet["total_hours"],
        "status": timesheet["status"],
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
        "created_at": timesheet["created_at"].isoformat() if isinstance(timesheet["created_at"], datetime) else str(timesheet["created_at"]),
        "updated_at": timesheet["updated_at"].isoformat() if isinstance(timesheet["updated_at"], datetime) else str(timesheet["updated_at"])
    }

@api_router.put("/timesheets/{timesheet_id}")
async def update_timesheet(timesheet_id: str, update: TimesheetUpdate, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    if timesheet["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    if timesheet["status"] != "submitted" and timesheet["status"] != "rejected":
        raise HTTPException(status_code=400, detail="Cannot edit approved timesheet")
    
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if "days" in update_data:
        update_data["days"] = [d if isinstance(d, dict) else d.model_dump() for d in update_data["days"]]
        # Recalculate PM IDs
        pm_ids = set()
        for day in update_data["days"]:
            for entry in day.get("entries", []):
                if entry.get("project_manager_id"):
                    pm_ids.add(entry["project_manager_id"])
        update_data["pm_ids"] = list(pm_ids)
    
    update_data["updated_at"] = datetime.now(timezone.utc)
    update_data["status"] = "submitted"
    update_data["pm_approved"] = False
    update_data["admin_approved"] = False
    
    await db.timesheets.update_one({"_id": ObjectId(timesheet_id)}, {"$set": update_data})
    return {"message": "Timesheet updated"}

@api_router.delete("/timesheets/{timesheet_id}")
async def delete_timesheet(timesheet_id: str, request: Request):
    user = await get_current_user(request)
    
    timesheet = await db.timesheets.find_one({"_id": ObjectId(timesheet_id)})
    if not timesheet:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    
    if timesheet["user_id"] != user["id"] and user["role"] != "admin":
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
    
    if approval.action == "approve":
        # Get PM info
        pm_signature_data = {
            "pm_id": user["id"],
            "pm_name": user["name"],
            "signature": approval.signature,
            "signed_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Add signature to the list
        existing_signatures = timesheet.get("pm_signatures", [])
        existing_signatures.append(pm_signature_data)
        
        # Check if all PMs have signed
        pm_ids_signed = {s["pm_id"] for s in existing_signatures}
        all_pms_signed = all(pm_id in pm_ids_signed for pm_id in timesheet.get("pm_ids", []))
        
        update_data = {
            "pm_signatures": existing_signatures,
            "updated_at": datetime.now(timezone.utc)
        }
        
        if all_pms_signed or len(existing_signatures) > 0:
            update_data["pm_approved"] = True
            update_data["pm_approved_by"] = user["id"]
            update_data["pm_approved_at"] = datetime.now(timezone.utc)
            update_data["status"] = "pm_approved"
        
        await db.timesheets.update_one(
            {"_id": ObjectId(timesheet_id)},
            {"$set": update_data}
        )
        return {"message": "Timesheet approved by PM"}
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
    
    users = await db.users.find({}, {"_id": 1, "email": 1, "name": 1, "role": 1, "created_at": 1}).to_list(1000)
    return [{
        "id": str(u["_id"]),
        "email": u["email"],
        "name": u["name"],
        "role": u["role"],
        "created_at": u["created_at"].isoformat() if isinstance(u["created_at"], datetime) else str(u.get("created_at", ""))
    } for u in users]

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
    memory_dir = Path(__file__).resolve().parent / "memory"
    memory_dir.mkdir(exist_ok=True)
    with open(memory_dir / "test_credentials.md", "w") as f:
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
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

