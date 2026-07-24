@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)

set "NODE_USE_ENV_PROXY=1"
call npm start
if errorlevel 1 (
  echo.
  echo CodexLink failed to start.
  pause
  exit /b 1
)
