@echo off
REM HGS Agent'i tamamen durdurup yeniden baslat (DEBUG modu)
echo === Calisan HGS Agent node islemlerini durdur ===
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *hgs-agent*" 2>nul
REM Tum node.exe'leri oldurmek istemediginiz icin yukaridaki yeterli olmali.
REM Daha kati gerekirse: taskkill /F /IM node.exe (DIKKAT: diger node app'lerini de durdurur)

timeout /t 2 /nobreak >nul

cd /d "%~dp0"
echo === HGS Agent (DEBUG modu) baslatiliyor ===
node hgs-agent.js
pause
