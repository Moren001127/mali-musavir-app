$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  AGENT BASLAT + OTOMATIK RESTART KURULUMU" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# --- 1) Mevcut task'i AtLogOn YANINDA AtStartup + her dakika check ile guncelle
Write-Host "[1/4] Ana task'i guncelliyorum (logon + her 1dk watcher)..." -ForegroundColor Yellow

$TaskName = 'Moren Luca Local Agent'
$BaseDir = "C:\Users\$env:USERNAME\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app\apps\luca-local-agent"
if (-not (Test-Path $BaseDir)) {
    # alternatif yollari dene
    foreach ($p in @(
        "$env:USERPROFILE\mali-musavir-app\apps\luca-local-agent",
        "C:\moren\mali-musavir-app\apps\luca-local-agent"
    )) { if (Test-Path $p) { $BaseDir = $p; break } }
}
$StartScript = Join-Path $BaseDir 'scripts\start-agent.ps1'
if (-not (Test-Path $StartScript)) {
    Write-Host "  HATA: start-agent.ps1 bulunamadi ($StartScript)" -ForegroundColor Red
    Read-Host "Enter'a basin"
    exit 1
}
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"" `
    -WorkingDirectory $BaseDir

# 2 trigger: kullanici logon + her 1 dakikada bir
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 365)

# IgnoreNew: zaten calisiyor ise yeni instance acma -> idempotent
# RestartCount: crash olursa 10 kez retry
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 7) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($t1, $t2) `
    -Settings $settings `
    -Principal $principal `
    -Description 'Moren Luca Local Agent - logon + her 1dk watchdog' `
    -Force | Out-Null

Write-Host "  Task guncellendi (AtLogOn + her 1dk tekrar)" -ForegroundColor Green
Write-Host ""

# --- 2) Mevcut node.exe agent'lari kapat (eski varsa) -----------------------
Write-Host "[2/4] Eski agent process'lerini temizliyorum..." -ForegroundColor Yellow
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*luca-local-agent*' } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
    }
Write-Host "  $killed process kapatildi" -ForegroundColor DarkGray
Start-Sleep -Seconds 2
Write-Host ""

# --- 3) Task'i hemen calistir ----------------------------------------------
Write-Host "[3/4] Ajan'i baslatiyorum..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 6
Write-Host ""

# --- 4) Sonuc kontrolu -----------------------------------------------------
Write-Host "[4/4] Sonuc:" -ForegroundColor Yellow
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*luca-local-agent*' }
if ($running) {
    foreach ($p in $running) {
        $rss = [math]::Round($p.WorkingSetSize/1MB, 1)
        Write-Host "  AJAN CALISIYOR  PID=$($p.ProcessId)  RAM=$rss MB" -ForegroundColor Green
    }
} else {
    Write-Host "  Ajan henuz baslamadi. Task Scheduler 1dk icinde tekrar deneyecek." -ForegroundColor Yellow
    Write-Host "  Birkac dakika bekleyip tekrar kontrol et:" -ForegroundColor Yellow
    Write-Host "    Get-CimInstance Win32_Process -Filter `"Name='node.exe'`" | Where-Object { `$_.CommandLine -like '*luca-local-agent*' }" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Son log satirlari:" -ForegroundColor Yellow
$logPath = Join-Path $BaseDir 'agent.current.out.log'
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
} else {
    Write-Host "  Log dosyasi yok" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  ARTIK:" -ForegroundColor Green
Write-Host "  - Agent her 1 dakikada bir Task Scheduler tarafindan kontrol edilir" -ForegroundColor White
Write-Host "  - Eger calismiyor ise OTOMATIK baslatilir" -ForegroundColor White
Write-Host "  - Crash + RAM/timeout exit'leri 1dk icinde geri gelecek" -ForegroundColor White
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Enter'a basin"
