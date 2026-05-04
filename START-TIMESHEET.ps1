Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location 'D:\Timesheet Manager\backend'; `$env:PYTHONUNBUFFERED='1'; python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000"
)

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location 'D:\Timesheet Manager\frontend'; `$env:PORT='3001'; `$env:BROWSER='none'; `$env:REACT_APP_BACKEND_URL='http://127.0.0.1:8000'; npm start"
)

Start-Sleep -Seconds 10
Start-Process "http://localhost:3001/login"
