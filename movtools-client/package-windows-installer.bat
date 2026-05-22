@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "SCRIPT_NAME=Movtools Client Windows Packaging"
set "LOG_DIR=%~dp0dist-logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "LOG_FILE=%LOG_DIR%\package-%STAMP%.log"

echo ========================================
echo   %SCRIPT_NAME%
echo ========================================
echo Log: %LOG_FILE%
echo.

echo [1/4] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not available in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available in PATH.
  pause
  exit /b 1
)

echo [2/4] Preparing release workspace...
call npm run prepare:release >"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo [3/4] Building app and runtime...
call npm run build >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

call npm run prepare:icons >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

call npm run prepare:runtime >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo [4/4] Creating Windows installer...
call npm run dist:win >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo.
echo [OK] Packaging completed successfully.
echo [OK] Output folder: %~dp0release
start "" "%~dp0release"
exit /b 0

:fail
echo.
echo [ERROR] Packaging failed. Showing last log lines:
powershell -NoProfile -Command "Get-Content -Path '%LOG_FILE%' -Tail 80"
echo.
echo [ERROR] Full log: %LOG_FILE%
pause
exit /b 1
