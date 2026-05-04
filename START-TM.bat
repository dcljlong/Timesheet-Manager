@echo off
title Start Timesheet Manager

echo Starting Timesheet Manager backend...
start "TM Backend" cmd /k "cd /d D:\Timesheet Manager\backend && uvicorn server:app --reload --host 127.0.0.1 --port 8000"

echo Starting Timesheet Manager frontend...
start "TM Frontend" cmd /k "cd /d D:\Timesheet Manager\frontend && set PORT=3001 && set BROWSER=none && set REACT_APP_BACKEND_URL=http://127.0.0.1:8000 && npx craco start"

timeout /t 10 /nobreak >nul
start "" "http://localhost:3001/login"

exit
