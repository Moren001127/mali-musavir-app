@echo off
REM Luca Local Agent baslat
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-agent.ps1"
pause
