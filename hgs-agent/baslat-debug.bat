@echo off
REM HGS Agent'i HEADLESS=false (Chromium gorunur) modda baslat
cd /d "%~dp0"
echo HGS Agent (DEBUG modu - Chromium gorunur) baslatiliyor...
node hgs-agent.js
pause
