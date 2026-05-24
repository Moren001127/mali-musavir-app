@echo off
REM HGS + WhatsApp + Log paneli + Agent fix push (tum HGS-related dosyalar)
cd /d "%~dp0\.."

echo === Git lock dosyasi temizleniyor ===
if exist .git\index.lock del /f /q .git\index.lock
if exist hgs-agent\.env.bak del /f /q hgs-agent\.env.bak

echo === Tum HGS-related modified dosyalari add ===
git add apps\api\src\galeri\ ^
        apps\api\src\agent-events\agent-events.controller.ts ^
        apps\api\src\agent-events\agent-events.service.ts ^
        apps\api\src\agent-events\agent-events.module.ts ^
        apps\api\src\whatsapp-qr\whatsapp-qr.service.ts ^
        apps\api\src\schedule\hgs.cron.ts ^
        "apps\web\src\app\(panel)\panel\galeri\hgs-ihlal\page.tsx" ^
        hgs-agent\hgs-agent.js ^
        hgs-agent\.gitignore ^
        hgs-agent\README.md ^
        hgs-agent\.env.example ^
        hgs-agent\package.json ^
        hgs-agent\package-lock.json ^
        hgs-agent\hgs-self-heal.ps1 ^
        hgs-agent\hgs-kurulum.ps1 ^
        hgs-agent\KURULUM-tek-tikla.bat ^
        hgs-agent\hgs-durdur.bat ^
        hgs-agent\restart-agent.bat ^
        hgs-agent\baslat-debug.bat ^
        hgs-agent\zombi-chromium-temizle.bat ^
        hgs-agent\push-hgs.bat

echo === Commit + push ===
git commit -m "fix: WhatsApp QR (Baileys) gonderim + disconnect event + agent kapali fix + PDF buffer + login fix"
git push origin main

echo.
echo === BITTI - Railway/Vercel deploy ~2-3dk surecek ===
pause
