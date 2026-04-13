@echo off
chcp 65001 >nul
title Smart Calendar - Environment Setup

REM Switch to script directory to ensure deps install in project folder
cd /d "%~dp0"

echo =======================================
echo   Smart Calendar Environment Setup
echo =======================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download from https://nodejs.org and install, then retry.
    echo.
    echo Recommended: Download Node.js 18+ LTS version
    echo.
    pause
    exit /b 1
)

REM Check Node.js version >= 18
echo Checking Node.js version...
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do (
    set "NODE_VER=%%v"
)
set "NODE_VER=%NODE_VER:v=%"
if %NODE_VER% lss 18 (
    echo [WARNING] Node.js version is lower than 18. Some features may not work.
    echo Recommended: Upgrade to Node.js 18+ LTS version from https://nodejs.org
    echo.
)
node -v
echo.

REM Check npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not available!
    echo npm should come bundled with Node.js. Please reinstall Node.js.
    echo.
    pause
    exit /b 1
)

echo Installing dependencies in project folder...
echo   Target: %~dp0node_modules
echo.

call npm install

if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed!
    echo Please check your network connection and try again.
    pause
    exit /b 1
)

echo.
echo =======================================
echo   Environment setup completed!
echo =======================================
echo.
echo Dependencies installed in: %~dp0node_modules
echo.
echo To start the application, run:
echo   start.bat
echo.
echo Or manually:
echo   npm run dev:all
echo.
pause
