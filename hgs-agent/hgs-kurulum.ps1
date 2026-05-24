$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$selfHealScript = Join-Path $scriptDir "hgs-self-heal.ps1"

if (-not (Test-Path $selfHealScript)) {
  Write-Host "X hgs-self-heal.ps1 not found: $selfHealScript" -ForegroundColor Red
  exit 1
}

Write-Host "=== Moren HGS Agent Auto-Start Setup ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Self-heal script: $selfHealScript"
Write-Host ""

# Yontem: Windows Startup folder'a VBS shortcut koy.
# VBS PowerShell'i tamamen gizli baslatir (siyah pencere acmadan).
# Avantaj: Admin yetkisi gerekmez, sadece current user icin.

$startupFolder = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startupFolder "Moren-HGS-Agent.vbs"

# VBS icerik - PowerShell'i hidden window ile baslatir
$vbsContent = @"
' Moren HGS Agent - Otomatik baslatici
' Bu dosya Windows Startup folder'da, oturum acildiginda calisir
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$selfHealScript""", 0, False
"@

Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII -Force

Write-Host "Startup VBS olusturuldu: $vbsPath" -ForegroundColor Green
Write-Host ""

# Eski Task Scheduler kaydi varsa sil (temizlik)
$oldTask = Get-ScheduledTask -TaskName "Moren HGS Agent" -ErrorAction SilentlyContinue
if ($oldTask) {
  Write-Host "Eski Task Scheduler kaydi siliniyor..."
  Unregister-ScheduledTask -TaskName "Moren HGS Agent" -Confirm:$false -ErrorAction SilentlyContinue
}

# Calisan eski node islemleri varsa durdur
Write-Host "Eski HGS agent islemleri durduruluyor (varsa)..."
$existing = Get-WmiObject Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*hgs-agent.js*' }
foreach ($p in $existing) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Hemen baslat (ilk seferlik, bilgisayar yeniden baslatmadan calissin)
Write-Host "HGS Agent simdi baslatiliyor..." -ForegroundColor Yellow
$null = wscript.exe $vbsPath

Start-Sleep -Seconds 3

# Calisiyor mu kontrol
$running = Get-WmiObject Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*hgs-agent.js*' }
if ($running) {
  Write-Host ""
  Write-Host "BASARILI - HGS Agent calisiyor (PID: $($running.ProcessId))" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Agent baslatildi ama henuz process bulunamadi - 10 saniye sonra tekrar kontrol edin" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Bundan sonra: Bilgisayar acildiginda HGS Agent otomatik baslar."
Write-Host "Loglar: $scriptDir\self-heal.log + agent.out.log"
Write-Host ""
Write-Host "Durdurmak icin: hgs-durdur.bat (yakinda eklenecek) veya manuel:"
Write-Host "  Stop-Process -Name node -Force  (DIKKAT: tum node islemlerini durdurur)"
Write-Host ""
Read-Host "Kapatmak icin Enter'a bas"
