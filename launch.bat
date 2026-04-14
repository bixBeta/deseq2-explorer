@echo off
REM =============================================================================
REM DESeq2 Explorer — Desktop Launcher (Windows)
REM Double-click this file or run from Command Prompt
REM =============================================================================
setlocal EnableDelayedExpansion

set IMAGE=ghcr.io/bixbeta/deseq2-explorer:latest
set COMPOSE_FILE=docker-compose.desktop.yml
set PORT=3000
set URL=http://localhost:%PORT%

echo.
echo  =========================================
echo   DESeq2 Explorer — Starting up
echo  =========================================
echo.

REM ── 1. Check Docker is running ───────────────────────────────────────────────
echo [1/4] Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker is not running.
    echo Please start Docker Desktop, wait for it to fully load,
    echo then run this script again.
    echo.
    pause
    exit /b 1
)
echo       Docker is running.

REM ── 2. Pull latest image ─────────────────────────────────────────────────────
echo.
echo [2/4] Pulling latest image (first run may take several minutes)...
docker pull %IMAGE%
if errorlevel 1 (
    echo [ERROR] Failed to pull image. Check your internet connection.
    pause
    exit /b 1
)

REM ── 3. Start container ───────────────────────────────────────────────────────
echo.
echo [3/4] Starting DESeq2 Explorer...
docker compose -f %COMPOSE_FILE% up -d
if errorlevel 1 (
    echo [ERROR] Failed to start the app.
    pause
    exit /b 1
)

REM ── 4. Wait until ready ──────────────────────────────────────────────────────
echo.
echo [4/4] Waiting for app to be ready...
set TRIES=0
:wait_loop
timeout /t 5 /nobreak >nul
curl -sf %URL%/api/ping >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 24 (
    echo.
    echo [ERROR] App did not start in time.
    echo Check logs with: docker compose -f %COMPOSE_FILE% logs
    pause
    exit /b 1
)
echo        Still starting... (attempt %TRIES%/24)
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
