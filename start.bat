@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)

if not defined HTTPS_PROXY (
  for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable 2^>nul') do set "CODEXLINK_PROXY_ENABLED=%%B"
  if "!CODEXLINK_PROXY_ENABLED!"=="0x1" (
    for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2^>nul') do set "CODEXLINK_PROXY_SERVER=%%B"
    if defined CODEXLINK_PROXY_SERVER (
      set "HTTP_PROXY=http://!CODEXLINK_PROXY_SERVER!"
      set "HTTPS_PROXY=http://!CODEXLINK_PROXY_SERVER!"
    )
  )
)
set "NODE_USE_ENV_PROXY=1"
call npm start
if errorlevel 1 (
  echo.
  echo CodexLink failed to start.
  pause
  exit /b 1
)
