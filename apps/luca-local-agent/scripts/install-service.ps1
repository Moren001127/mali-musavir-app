# =============================================================================
# Luca Local Agent — Windows servis (Task Scheduler) kurulum / onarim scripti
# =============================================================================
# Bu script her ofis PC'sinde aynen calisir. Hicbir yere sabit kullanici / disk
# yolu yazilmamistir. Node yolu where.exe ile otomatik bulunur, agent klasoru
# scriptin kendi konumundan turetilir.
#
# Calistirma:
#   onar-servis.bat -> sag tik -> Yonetici olarak calistir
# veya manuel olarak:
#   PowerShell (Yonetici) -> .\install-service.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'

$TaskName = 'Luca Local Agent'

function Write-Section($text) {
    Write-Host ''
    Write-Host "=== $text ===" -ForegroundColor Cyan
}

function Write-Ok($text)   { Write-Host "[OK]   $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "[INFO] $text" -ForegroundColor Gray }
function Write-Warn($text) { Write-Host "[WARN] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "[HATA] $text" -ForegroundColor Red }

# --- 1) Yonetici kontrolu --------------------------------------------------
Write-Section 'Yonetici yetkisi kontrolu'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Err 'Bu script YONETICI olarak calistirilmali.'
    Write-Host ''
    Write-Host 'Yapilacak: onar-servis.bat dosyasina SAG TIK -> "Yonetici olarak calistir"' -ForegroundColor Yellow
    Write-Host ''
    Read-Host 'Cikmak icin Enter'
    exit 1
}
Write-Ok 'Yonetici hakkiyla calisiyor.'

# --- 2) Agent klasorunu bul ------------------------------------------------
Write-Section 'Agent klasoru'
# Scriptin oldugu klasorun parent'i = agent klasoru
$AgentDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $AgentDir 'src\agent.js'))) {
    Write-Err "Agent klasoru bulunamadi: $AgentDir"
    Write-Err 'Bu scripti apps\luca-local-agent\scripts\ altindan calistir.'
    Read-Host 'Cikmak icin Enter'
    exit 1
}
Write-Ok "Agent klasoru: $AgentDir"

$VbsPath = Join-Path $AgentDir 'start-hidden.vbs'
if (-not (Test-Path $VbsPath)) {
    Write-Err "start-hidden.vbs bulunamadi: $VbsPath"
    Read-Host 'Cikmak icin Enter'
    exit 1
}
Write-Ok "Launcher: $VbsPath"

# --- 3) Node.js kontrolu (taşinabilir bulma) -------------------------------
Write-Section 'Node.js kontrolu'
$nodePath = $null
try {
    $whereOut = & where.exe node 2>$null
    if ($LASTEXITCODE -eq 0 -and $whereOut) {
        $nodePath = ($whereOut | Select-Object -First 1).Trim()
    }
} catch { }

if (-not $nodePath) {
    $fallbacks = @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($p in $fallbacks) {
        if (Test-Path $p) { $nodePath = $p; break }
    }
}

if (-not $nodePath) {
    Write-Err 'Node.js bulunamadi.'
    Write-Host ''
    Write-Host 'Once Node.js LTS yukle: https://nodejs.org/en/download/' -ForegroundColor Yellow
    Write-Host 'Kurulum bittikten sonra bu scripti tekrar calistir.' -ForegroundColor Yellow
    Read-Host 'Cikmak icin Enter'
    exit 1
}
Write-Ok "Node.js: $nodePath"

# --- 4) Eski gorevi sil ----------------------------------------------------
Write-Section 'Eski servis kaydi temizleniyor'
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    try {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    } catch { }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Ok "Eski '$TaskName' gorevi silindi."
} else {
    Write-Info 'Eski gorev yok, atlandi.'
}

# Eski hatali agent.service.err.log'u temizle
$errLog = Join-Path $AgentDir 'agent.service.err.log'
$outLog = Join-Path $AgentDir 'agent.service.out.log'
if (Test-Path $errLog) { Clear-Content -Path $errLog -ErrorAction SilentlyContinue }
if (Test-Path $outLog) { Clear-Content -Path $outLog -ErrorAction SilentlyContinue }
Write-Ok 'Servis loglari sifirlandi (temiz baslangic).'

# --- 5) Yeni Task Scheduler kaydi ------------------------------------------
# Onemli: -Argument'a SADECE dosya adi veriyoruz, kendimiz tirnak EKLEMIYORUZ.
# Register-ScheduledTask cmdlet'i path'leri otomatik dogru escape eder. cmd.exe
# wrapper'i devreye girmedigi icin "Program Files" bosluk sorunu olusmaz.
Write-Section 'Yeni servis kaydi olusturuluyor'

$action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument 'start-hidden.vbs' `
    -WorkingDirectory $AgentDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

# Kullanicinin oturumunda calissin (S4U/InteractiveToken). SYSTEM degil cunku
# Playwright headless Chromium'un Luca cookie / .browser-data klasorune erisimi
# kullanici profilinde.
$principalObj = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principalObj `
    -Description 'Luca Local Agent - ofis PC arka plan worker. Railway API polling + Luca Playwright otomasyon.' | Out-Null

Write-Ok "'$TaskName' gorevi olusturuldu."

# --- 6) Hemen baslat -------------------------------------------------------
Write-Section 'Servis tetikleniyor'
try {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
    Write-Ok "Son calistirma zamani: $($info.LastRunTime)"
    Write-Ok "Son calistirma sonucu: $($info.LastTaskResult) (0 = OK, 267009 = calisiyor)"
} catch {
    Write-Warn "Otomatik tetikleme yapilamadi: $($_.Exception.Message)"
    Write-Warn 'Bir kez oturumu kapatip acinca otomatik calisacak.'
}

# --- 7) Dogrulama ----------------------------------------------------------
Write-Section 'Dogrulama'
Start-Sleep -Seconds 3
$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'agent\.js' }

if ($nodeProcs) {
    Write-Ok "node.exe agent.js calisiyor (PID: $(($nodeProcs | Select-Object -ExpandProperty ProcessId) -join ', '))"
} else {
    Write-Warn 'Henuz node.exe agent.js gorunmuyor. 30 sn icinde Task Scheduler tekrar deneyecek.'
    Write-Warn 'Manuel kontrol icin: Get-ScheduledTask -TaskName "Luca Local Agent" | Get-ScheduledTaskInfo'
}

# --- 8) Ozet ---------------------------------------------------------------
Write-Section 'KURULUM TAMAM'
Write-Host ''
Write-Host '  Gorev adi   : ' -NoNewline; Write-Host $TaskName -ForegroundColor White
Write-Host '  Calisma dizini: ' -NoNewline; Write-Host $AgentDir -ForegroundColor White
Write-Host '  Tetikleyici : ' -NoNewline; Write-Host 'Oturum acildiginda' -ForegroundColor White
Write-Host '  Launcher    : ' -NoNewline; Write-Host 'wscript.exe start-hidden.vbs (gizli pencere)' -ForegroundColor White
Write-Host ''
Write-Host '  Log dosyalari:' -ForegroundColor Gray
Write-Host "    $AgentDir\agent-debug.log         (anlik aktivite)"
Write-Host "    $AgentDir\agent.current.out.log   (canli stdout)"
Write-Host "    $AgentDir\agent.current.err.log   (canli stderr)"
Write-Host ''
Write-Host '  Servisi kaldirmak icin: scripts\kaldir-servis.bat' -ForegroundColor Gray
Write-Host ''
Read-Host 'Kapatmak icin Enter'
