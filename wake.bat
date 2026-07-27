@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest 'http://127.0.0.1:17321/wake' -UseBasicParsing | Out-Null; Write-Host 'CodexLink wake signal sent.' } catch { Write-Error $_.Exception.Message; exit 1 }"
