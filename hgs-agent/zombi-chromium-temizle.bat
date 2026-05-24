@echo off
REM Playwright'tan kalan gorulen Chromium pencerelerini kapatir.
REM Sadece ms-playwright konumundaki Chromium'lari etkiler — kendi Chrome'unu acmazsin.

echo Playwright Chromium pencereleri kapatiliyor...
powershell.exe -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*ms-playwright*' -or $_.Path -like '*playwright*' } | ForEach-Object { Write-Host ('Kapatildi PID: ' + $_.Id + ' Path: ' + $_.Path); Stop-Process -Id $_.Id -Force }"
echo.
echo Bitti.
pause
