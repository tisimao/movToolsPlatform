@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Movtools Server Deploy

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul || (
  echo Failed to enter project directory.
  exit /b 1
)

echo [1/5] Checking Docker...
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found in PATH.
  goto :fail
)

echo [2/5] Checking Docker Desktop...
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker daemon is not available. Please start Docker Desktop first.
  goto :fail
)

echo [3/5] Preparing environment file...
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    if errorlevel 1 (
      echo Failed to create .env from .env.example.
      goto :fail
    )
    echo Created .env from .env.example. Review secrets before exposing the service publicly.
  ) else (
    echo Missing both .env and .env.example.
    goto :fail
  )
)

echo [4/5] Detecting Compose command...
set "COMPOSE_CMD=docker compose"
docker compose version >nul 2>nul
if errorlevel 1 set "COMPOSE_CMD=docker-compose"

echo [5/5] Building and starting services...
call %COMPOSE_CMD% up -d --build
if errorlevel 1 (
  echo Deployment failed while running %COMPOSE_CMD%.
  goto :fail
)

echo.
echo Deployment completed successfully.
echo.
echo Services:
echo   API      : http://localhost:5001
echo   Postgres : localhost:5432
echo.
echo Useful commands:
echo   docker compose logs -f api
echo   docker compose ps
echo.
pause
popd >nul
exit /b 0

:fail
echo.
echo Deployment failed.
echo Please check Docker Desktop, .env, and the compose logs.
pause
popd >nul
exit /b 1
