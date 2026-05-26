@echo off
REM Luca Local Agent'a 2captcha paketini yukle
cd /d "%~dp0"
echo === Luca Local Agent 2captcha kurulumu ===
echo.
call npm install 2captcha
echo.
echo === BITTI ===
echo Luca agent'i yeniden baslat (mevcut node islemini durdur, sonra baslat)
pause
