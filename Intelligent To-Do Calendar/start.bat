@echo off
chcp 65001 >nul
title Smart Calendar Planner

REM Switch to script directory
cd /d "%~dp0"

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download from https://nodejs.org and install, then retry.
    pause
    exit /b 1
)

REM Auto-install dependencies if node_modules missing
if not exist node_modules (
    echo =======================================
    echo   Installing dependencies...
    echo =======================================
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] npm install failed!
        echo Please check your network connection and try again.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully.
    echo.
)

echo ===============================
echo   Smart Calendar Planner
echo ===============================
echo.
echo Starting services...
echo.

REM Start backend server in background
echo Starting backend server...
start /b npm run dev:server

REM Wait for backend to be ready
echo Waiting for backend server to be ready...
:waitloop_backend
timeout /t 1 /nobreak >nul
powershell -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000/api/calendar/calendars' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% neq 0 goto waitloop_backend
echo Backend server is ready (http://localhost:3000).
echo.

REM Start frontend dev server (foreground, Ctrl+C to quit)
echo Starting frontend dev server...
echo The browser will open automatically.
echo Press Ctrl+C to stop the application.
echo.
npm run dev

REM Cleanup backend process after frontend exits
echo.
echo Stopping backend server...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000.*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo Done.
pause
