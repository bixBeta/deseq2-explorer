@echo off
REM =============================================================================
REM DESeq2 Explorer — Desktop Launcher (Windows)
REM Double-click this file or run from Command Prompt
REM =============================================================================
setlocal EnableDelayedExpansion

set IMAGE=bixbeta/deseq2-explorer:latest
set COMPOSE_FILE=docker-compose.desktop.yml
set PORT=3000
set URL=http://localhost:%PORT%

echo.
echo  =========================================
echo   DESeq2 Explorer -- Starting up
echo  =========================================
echo.

REM ── 1. Check Docker is running (with retry + timeout) ────────────────────────
echo [1/4] Checking Docker Desktop...
set DOCKER_TRIES=0
:docker_check
docker version >nul 2>&1
if not errorlevel 1 goto docker_ok
set /a DOCKER_TRIES+=1
if %DOCKER_TRIES% geq 10 (
    echo.
    echo [ERROR] Docker Desktop does not appear to be running.
    echo Please open Docker Desktop from the Start Menu, wait for the
    echo whale icon to appear in the taskbar, then run this script again.
    echo.
    pause
    exit /b 1
)
echo        Waiting for Docker to start... (%DOCKER_TRIES%/10)
timeout /t 5 /nobreak >nul
goto docker_check

:docker_ok
echo        Docker is ready.

REM ── 2. Ensure data volume exists ─────────────────────────────────────────────
docker volume create deseq2_data >nul 2>&1

REM ── 3. Pull latest image ─────────────────────────────────────────────────────
echo.
echo [2/4] Pulling latest image (first run may take several minutes)...
docker pull %IMAGE%
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to pull image. Check your internet connection.
    pause
    exit /b 1
)

REM ── 4. Start container ───────────────────────────────────────────────────────
echo.
echo [3/4] Starting DESeq2 Explorer...
docker compose -f %COMPOSE_FILE% up -d
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start the container.
    echo Check logs with: docker compose -f %COMPOSE_FILE% logs
    pause
    exit /b 1
)

REM ── 5. Wait until ready ──────────────────────────────────────────────────────
echo.
echo [4/4] Waiting for app to be ready (this may take ~60s on first run)...
set TRIES=0
:wait_loop
timeout /t 5 /nobreak >nul
curl -sf %URL%/api/ping >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 24 (
    echo.
    echo [ERROR] App did not become ready in time.
    echo Check logs with: docker compose -f %COMPOSE_FILE% logs
    pause
    exit /b 1
)
echo        Still starting... (%TRIES%/24)
goto wait_loop

:ready
echo.
echo  =========================================
echo   App is ready!  Opening browser...
echo  =========================================
echo.
start %URL%

echo DESeq2 Explorer is running at %URL%
echo To stop the app, run stop.bat
echo.
pause
