@echo off
title DB Viewer
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found. Install Node.js and pnpm, then try again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo No .env file found. Copy .env.example to .env and add your SQL credentials.
  pause
  exit /b 1
)

echo Starting DB Viewer...
echo   UI:  http://localhost:5173
echo   API: http://localhost:3001
echo.
echo Close this window to stop the app.
echo.

start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173/"

call pnpm dev
