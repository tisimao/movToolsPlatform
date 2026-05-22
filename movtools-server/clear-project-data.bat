@echo off
setlocal EnableExtensions

set "CONN=%Database__ConnectionString%"
if not defined CONN set "CONN=Host=localhost;Port=5432;Database=movtools_server_dev;Username=movtools;Password=movtools_dev"

where psql >nul 2>nul
if errorlevel 1 (
  echo [ERROR] psql not found in PATH. Install PostgreSQL client tools first.
  exit /b 1
)

set "SQL=DO $$ DECLARE r RECORD; BEGIN FOR r IN ( SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('activity_logs','client_nodes','client_path_mappings','episodes','lenses','lens_status_histories','project_members','projects','review_comments','review_tasks') ) LOOP EXECUTE format('TRUNCATE TABLE public.%%I RESTART IDENTITY CASCADE;', r.tablename); END LOOP; END $$;"

echo Clearing project-related data...
psql "%CONN%" -v ON_ERROR_STOP=1 -c "%SQL%"
if errorlevel 1 (
  echo [ERROR] Failed to clear project-related data.
  exit /b 1
)

echo [OK] Project-related data cleared.
endlocal
