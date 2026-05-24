@echo off
REM HGS Agent'i tamamen durdur (manuel)
echo HGS Agent durduruluyor...
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -like '*hgs-agent.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Durduruldu PID: ' + $_.ProcessId) }"
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*hgs-self-heal*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Durduruldu PID: ' + $_.ProcessId) }"
echo.
echo Bitti. Bilgisayar tekrar acildiginda Startup'tan yine baslar.
echo Tamamen kaldirmak icin: %%APPDATA%%\Microsoft\Windows\Start Menu\Programs\Startup\Moren-HGS-Agent.vbs sil
pause
