@echo off
REM Luca Local Agent'i durdur, yeni 2captcha kodunu yukle, sonra Task Scheduler ile yeniden baslat
cd /d "%~dp0"

echo === Calisan Luca node islemlerini durdur ===
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*luca-local-agent*' -or $_.CommandLine -like '*src/agent.js*' } | ForEach-Object { Write-Host ('Durduruldu PID: ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

echo.
echo === 2captcha paketi yukleniyor (eksikse) ===
call npm install 2captcha --silent 2>nul

echo.
echo === Task Scheduler ile yeniden baslatiliyor ===
powershell.exe -NoProfile -Command "Start-ScheduledTask -TaskName 'Moren Luca Local Agent' -ErrorAction SilentlyContinue; if ($?) { Write-Host 'Task baslatildi' -ForegroundColor Green } else { Write-Host 'Task bulunamadi - manuel baslatmaniz gerekebilir' -ForegroundColor Yellow }"

echo.
echo === BITTI ===
echo Luca agent yeni kod ile arka planda calisiyor.
echo Captcha cikarsa 2captcha ile otomatik cozulecek.
pause
