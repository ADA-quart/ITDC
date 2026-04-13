@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Smart Calendar Planner
cd /d "%~dp0"

REM -- Disable Vite auto-open (we open browser ourselves after services are ready) --
set "VITE_OPEN=false"

echo.
echo  +-----------------------------------------+
echo  ^|        Smart Calendar Planner           ^|
echo  +-----------------------------------------+
echo.

REM -- 1. Check Node.js --
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Please download from https://nodejs.org LTS 18+ and retry.
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
set "NODE_VER=%NODE_VER:v=%"
if %NODE_VER% lss 18 (
    echo  [WARNING] Node.js version is below 18. Some features may not work.
) else (
    echo  [OK] Node.js %NODE_VER%
)

REM -- 2. Init .env if missing --
if not exist .env (
    if exist .env.example (
        echo  [INFO] Creating .env from .env.example ...
        copy .env.example .env >nul
    )
)

REM -- 3. Install dependencies if node_modules missing --
if not exist node_modules (
    echo.
    echo  -- Installing dependencies --
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] npm install failed! Check your network connection.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
)

REM -- 4. Read backend port from .env --
set "BACKEND_PORT=3000"
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="PORT" set "BACKEND_PORT=%%b"
    )
)

REM -- 5. Detect LAN IP (the one with default gateway = router-assigned) --
set "LAN_IP="
for /f "usebackq" %%a in (`powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).RouteMetric" 2^>nul`) do (
    set "LAN_METRIC=%%a"
)
for /f "usebackq" %%a in (`powershell -NoProfile -Command "try { $r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric | Select-Object -First 1; $a = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction Stop; if ($a.Status -eq 'Up') { (Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop).IPAddress } } catch {}" 2^>nul`) do (
    set "LAN_IP=%%a"
)

REM -- 6. Kill leftover processes on target ports --
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%BACKEND_PORT%.*LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173.*LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
)

REM -- 7. Start backend server --
echo  -- Starting backend server (port %BACKEND_PORT%) ...
start /b cmd /c "set PORT=%BACKEND_PORT% && npm run dev:server >nul 2>nul"

echo  Waiting for backend ...
set "RETRY=0"
:wait_backend
timeout /t 1 /nobreak >nul
set /a "RETRY=RETRY+1"
if %RETRY% gtr 30 (
    echo  [WARNING] Backend did not start within 30s.
    goto backend_ready
)
powershell -Command "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('localhost', %BACKEND_PORT%); $t.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% neq 0 goto wait_backend
echo  [OK] Backend is ready.
:backend_ready

REM -- 8. Start frontend dev server --
echo  -- Starting frontend server (port 5173) ...
start /b cmd /c "npm run dev >nul 2>nul"

echo  Waiting for frontend ...
set "RETRY=0"
:wait_frontend
timeout /t 1 /nobreak >nul
set /a "RETRY=RETRY+1"
if %RETRY% gtr 30 (
    echo  [WARNING] Frontend did not start within 30s.
    echo            Try opening http://localhost:5173 manually.
    goto frontend_ready
)
powershell -Command "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('localhost', 5173); $t.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% neq 0 goto wait_frontend
echo  [OK] Frontend is ready.
:frontend_ready

REM -- 9. Open default browser --
echo  -- Opening browser ...
start "" "http://localhost:5173"

echo.
echo  +-----------------------------------------+
echo  ^|  Services are running!                  ^|
echo  ^|                                         ^|
echo  ^|  Local:    http://localhost:5173         ^|
if defined LAN_IP (
    echo  ^|  Network:  http://%LAN_IP%:5173        ^|
)
echo  ^|                                         ^|
echo  ^|  API:      http://localhost:%BACKEND_PORT%/api/health  ^|
echo  ^|                                         ^|
echo  ^|  Press any key to stop ...              ^|
echo  +-----------------------------------------+
echo.
pause >nul

REM -- 10. Cleanup: kill processes on both ports --
echo  Stopping services ...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%BACKEND_PORT%" ^| findstr "LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
)
echo  Done.
pause
