@echo off
chcp 65001 >nul
title Smart Calendar - Uninstall

REM Switch to script directory
cd /d "%~dp0"

echo ======================================
echo   Smart Calendar - Uninstall
echo ======================================
echo.

echo Choose uninstall mode:
echo   [1] Clean only   - Remove dependencies and data (keep source code)
echo   [2] Full delete  - Delete the ENTIRE project folder (everything gone!)
echo.

choice /c 12Q /m "Press 1=Clean, 2=Full delete, Q=Quit"
if %ERRORLEVEL% equ 3 (
    echo.
    echo Operation cancelled.
    pause
    exit /b 0
)
if %ERRORLEVEL% equ 2 goto :full_delete
goto :clean_only

REM ============================================================
REM  Mode 1: Clean only (remove dependencies / cache / data)
REM ============================================================
:clean_only

echo.
echo ======================================
echo   Stopping running services...
echo ======================================

echo Terminating all Node.js processes related to this project...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000.*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173.*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo [OK] Services stopped

echo.
echo ======================================
echo   Removing dependencies...
echo ======================================

if not exist node_modules goto :skip_node_modules
echo Removing node_modules...
mkdir "%TEMP%\empty_dir_for_cleanup" 2>nul
robocopy "%TEMP%\empty_dir_for_cleanup" "node_modules" /mir /r:1 /w:1 >nul 2>&1
(call )
rmdir /s /q node_modules 2>nul
rmdir /s /q "%TEMP%\empty_dir_for_cleanup" 2>nul
if not exist node_modules (
    echo [OK] node_modules removed
) else (
    echo [ERROR] Unable to remove node_modules - some files may be locked
)
goto :after_node_modules
:skip_node_modules
echo [SKIP] node_modules not found
:after_node_modules

if not exist package-lock.json goto :skip_pkglock
echo Removing package-lock.json...
del /q package-lock.json 2>nul
if not exist package-lock.json (
    echo [OK] package-lock.json removed
) else (
    echo [ERROR] Unable to remove package-lock.json
)
goto :after_pkglock
:skip_pkglock
echo [SKIP] package-lock.json not found
:after_pkglock

echo.
echo ======================================
echo   Removing build output...
echo ======================================

if not exist dist goto :skip_dist
echo Removing dist folder...
mkdir "%TEMP%\empty_dir_for_cleanup" 2>nul
robocopy "%TEMP%\empty_dir_for_cleanup" "dist" /mir /r:1 /w:1 >nul 2>&1
(call )
rmdir /s /q dist 2>nul
rmdir /s /q "%TEMP%\empty_dir_for_cleanup" 2>nul
if not exist dist (
    echo [OK] dist removed
) else (
    echo [ERROR] Unable to remove dist
)
goto :after_dist
:skip_dist
echo [SKIP] dist not found
:after_dist

if not exist tsconfig.tsbuildinfo goto :skip_tsinfo
echo Removing tsconfig.tsbuildinfo...
del /q tsconfig.tsbuildinfo 2>nul
if not exist tsconfig.tsbuildinfo (
    echo [OK] tsconfig.tsbuildinfo removed
) else (
    echo [ERROR] Unable to remove tsconfig.tsbuildinfo
)
goto :after_tsinfo
:skip_tsinfo
echo [SKIP] tsconfig.tsbuildinfo not found
:after_tsinfo

echo.
echo ======================================
echo   Removing database...
echo ======================================

if not exist data goto :skip_data
echo Removing data folder (calendar database)...
mkdir "%TEMP%\empty_dir_for_cleanup" 2>nul
robocopy "%TEMP%\empty_dir_for_cleanup" "data" /mir /r:1 /w:1 >nul 2>&1
(call )
rmdir /s /q data 2>nul
rmdir /s /q "%TEMP%\empty_dir_for_cleanup" 2>nul
if not exist data (
    echo [OK] data removed
) else (
    echo [ERROR] Unable to remove data
)
goto :after_data
:skip_data
echo [SKIP] data not found
:after_data

echo.
echo ======================================
echo   Clean completed!
echo ======================================
echo.
echo Source code is preserved. Removed items:
echo   - node_modules/ (dependencies)
echo   - dist/ (build output)
echo   - data/ (database)
echo   - package-lock.json
echo   - tsconfig.tsbuildinfo
echo.
echo To reinstall and start again, run: start.bat
echo.

pause
exit /b 0

REM ============================================================
REM  Mode 2: Full delete (remove entire project folder)
REM ============================================================
:full_delete

echo.
echo ======================================
echo   WARNING - FULL PROJECT DELETION
echo ======================================
echo.
echo This will permanently delete the ENTIRE project folder:
echo   %~dp0
echo.
echo This includes ALL source code, data, and configuration.
echo This action CANNOT be undone!
echo.

choice /c YN /m "Are you ABSOLUTELY sure you want to delete everything"
if %ERRORLEVEL% neq 1 (
    echo.
    echo Operation cancelled.
    pause
    exit /b 0
)

echo.
echo Stopping running services...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000.*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173.*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

REM
REM Key technique: We cannot delete the project folder while
REM this batch script is running inside it. So we create a
REM temporary "deleter" script in %TEMP%, launch it in a new
REM window, then exit this script immediately. The deleter
REM waits for us to exit, then removes the entire folder.
REM

echo Creating cleanup task...

set "PROJECT_DIR=%~dp0"
REM Remove trailing backslash for cleaner path
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

(
echo @echo off
echo chcp 65001 ^>nul
echo title Smart Calendar - Deleting Project...
echo echo.
echo echo Deleting project folder...
echo echo %PROJECT_DIR%
echo echo.
echo echo Waiting for the uninstaller to exit...
echo timeout /t 3 /nobreak ^>nul
echo.
echo echo Removing files...
echo mkdir "%TEMP%\empty_dir_for_cleanup" 2^>nul
echo robocopy "%TEMP%\empty_dir_for_cleanup" "%PROJECT_DIR%" /mir /r:1 /w:1 ^>nul 2^>^&1
echo rmdir /s /q "%PROJECT_DIR%" 2^>nul
echo rmdir /s /q "%TEMP%\empty_dir_for_cleanup" 2^>nul
echo.
echo if exist "%PROJECT_DIR%" ^(
echo     echo [ERROR] Some files could not be deleted.
echo     echo Please close any programs using the project folder and try again.
echo ^) else ^(
echo     echo [OK] Project folder has been completely removed.
echo ^)
echo echo.
echo pause
echo del /q "%%~f0" 2^>nul
echo exit
) > "%TEMP%\smart_calendar_deleter.bat"

echo [OK] Launching cleanup task...
echo The project folder will be deleted after this window closes.
echo.

start "Smart Calendar - Deleting Project" "%TEMP%\smart_calendar_deleter.bat"

exit
