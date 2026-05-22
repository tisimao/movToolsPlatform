@echo off
setlocal

cd /d "%~dp0"

set "LOCAL_NODE_DIR=%~dp0.runtime\node-current"
set "NODE_CMD=node"
set "NPM_CMD=npm"
if exist "%LOCAL_NODE_DIR%\node.exe" (
  set "PATH=%LOCAL_NODE_DIR%;%PATH%"
  set "NODE_CMD=%LOCAL_NODE_DIR%\node.exe"
  set "NPM_CMD=%LOCAL_NODE_DIR%\node_modules\npm\bin\npm-cli.js"
  echo [INFO] Using bundled project Node.js runtime from .runtime\node-current
)

title MovTools Client Dev Test Launcher

echo ========================================
echo   MovTools Client Dev Test Launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not available in PATH.
  echo Please install Node.js and reopen this script, or restore the bundled runtime.
  pause
  exit /b 1
)

if not exist "%LOCAL_NODE_DIR%\node.exe" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm is not available in PATH.
    echo Please install Node.js/npm and reopen this script, or restore the bundled runtime.
    pause
    exit /b 1
  )
)

if exist "%LOCAL_NODE_DIR%\node.exe" (
  if not exist "%NPM_CMD%" (
    echo [ERROR] Bundled npm launcher was not found.
    pause
    exit /b 1
  )
) else (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm is not available in PATH.
    echo Please install Node.js/npm and reopen this script, or restore the bundled runtime.
    pause
    exit /b 1
  )
)

if exist "%LOCAL_NODE_DIR%\node.exe" (
  for /f "tokens=1,2 delims=.v" %%A in ('"%NODE_CMD%" -v') do set NODE_MAJOR=%%A
) else (
  for /f "tokens=1,2 delims=.v" %%A in ('node -v') do set NODE_MAJOR=%%A
)

if not defined NODE_MAJOR (
  echo [ERROR] Failed to detect the current Node.js version.
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Detected Node.js v%NODE_MAJOR%.
  echo This project is tested with Node.js 20+.
  echo Please install Node.js 20 LTS or newer, then reopen this script.
  pause
  exit /b 1
)

echo [OK] Node.js and npm detected.
echo [OK] Detected Node major version: %NODE_MAJOR%

set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo [INFO] Electron mirror configured for this session.

if not defined API_BASE_URL set "API_BASE_URL=%VITE_API_BASE_URL%"
if not defined API_BASE_URL set "API_BASE_URL=http://localhost:5001"
set "API_HEALTH_URL=%API_BASE_URL%/health"

if not exist "node_modules" (
  echo.
  echo [INFO] node_modules not found. Running npm install...
  if exist "%LOCAL_NODE_DIR%\node.exe" (
    call "%NODE_CMD%" "%NPM_CMD%" install
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [ERROR] Electron runtime is missing.
  echo [ERROR] If npm install just ran, Electron may have failed to download.
  echo [ERROR] Please delete node_modules and rerun this script.
  pause
  exit /b 1
)

echo.
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [WARN] ffmpeg was not found in PATH.
  echo        You can still start the app, but media tasks may fail until FFmpeg path is configured in Settings.
) else (
  echo [OK] ffmpeg detected in PATH.
)

where ffprobe >nul 2>nul
if errorlevel 1 (
  echo [WARN] ffprobe was not found in PATH.
  echo        You can still start the app, but duration probing may fail until FFprobe path is configured in Settings.
) else (
  echo [OK] ffprobe detected in PATH.
)

echo.
echo [INFO] Expected server health endpoint: %API_HEALTH_URL%
echo [INFO] Please start movtools-server from Visual Studio or Rider before testing the client.
echo [INFO] Note: with server batch-1 only, health checks work but real login APIs may not exist yet.
echo [INFO] In that case, focus this round on client startup, login UI shell and API online/offline prompts.
set "VITE_API_BASE_URL=%API_BASE_URL%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri '%API_HEALTH_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { exit 0 } else { exit 2 } } catch { exit 1 }"

if errorlevel 2 (
  echo [WARN] Server responded unexpectedly at %API_HEALTH_URL%.
  echo [WARN] You can still continue, but client API checks may fail.
) else if errorlevel 1 (
  echo [WARN] Server is not reachable at %API_HEALTH_URL%.
  echo [WARN] Please confirm the server is started in IDE, then continue.
) else (
  echo [OK] Server health endpoint is reachable.
)

echo.
echo [INFO] Starting MovTools client in development mode...
echo [INFO] This script only starts the client.
echo [INFO] Keep the server running in your IDE while testing.
echo.

if exist "%LOCAL_NODE_DIR%\node.exe" (
  call "%NODE_CMD%" "%NPM_CMD%" run dev
) else (
  call npm run dev
)
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Client dev startup failed with code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

endlocal
