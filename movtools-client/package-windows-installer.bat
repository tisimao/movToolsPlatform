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

echo [0/5] Checking Node.js and npm...
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

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content -Raw -Path 'package.json' | ConvertFrom-Json).version"`) do set "CURRENT_VERSION=%%v"
echo Current version: %CURRENT_VERSION%
echo.

set "NEW_VERSION=%~1"
if "%NEW_VERSION%"=="" (
  set /p "NEW_VERSION=Enter new version (e.g. 1.3.11): "
)
if "%NEW_VERSION%"=="" (
  echo [ERROR] Version is required.
  pause
  exit /b 1
)

echo [1/5] Updating version to %NEW_VERSION%...
call npm version %NEW_VERSION% --no-git-tag-version --allow-same-version >"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content -Raw -Path 'package.json' | ConvertFrom-Json).version"`) do set "BUILD_VERSION=%%v"
echo Version set to: %BUILD_VERSION%
echo.

echo [2/5] Preparing release workspace...
call npm run prepare:release >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo [3/5] Building app and runtime...
call npm run build >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

call npm run prepare:icons >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

call npm run prepare:runtime >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo [4/5] Creating Windows installer...
call npm run dist:win >>"%LOG_FILE%" 2>&1
if errorlevel 1 goto :fail

echo [5/5] Verifying output...
echo.
echo ========================================
echo   Packaging completed
echo   Version: %BUILD_VERSION%
echo   Output:  %~dp0release
echo ========================================
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
