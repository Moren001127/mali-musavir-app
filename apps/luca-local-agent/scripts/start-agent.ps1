$ErrorActionPreference = 'Continue'

$BaseDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $BaseDir

$node = Get-Command node.exe -ErrorAction Stop
$stdout = Join-Path $BaseDir 'agent.current.out.log'
$stderr = Join-Path $BaseDir 'agent.current.err.log'
$wrapperLog = Join-Path $BaseDir 'agent.wrapper.log'

# Resilient launcher: hangi exit code gelirse gelsin agent'i tekrar baslat.
# Backoff: 5sn -> 15sn -> 30sn -> 60sn (max). Basarili calisma 5dk surerse counter sifirlanir.
$crashCount = 0
$lastStartTime = $null

function Get-NextDelay {
    param([int]$c)
    if ($c -le 1) { return 5 }
    elseif ($c -le 3) { return 15 }
    elseif ($c -le 5) { return 30 }
    else { return 60 }
}

function Write-Wrapper {
    param([string]$msg)
    $line = "[$((Get-Date).ToString('s'))] $msg"
    try { Add-Content -Path $wrapperLog -Value $line -Encoding utf8 -ErrorAction SilentlyContinue } catch {}
}

# OTO-GUNCELLEME (2026-06-08): wrapper basinda son kodu cek. Boylece agent.js
# duzeltmeleri her makineye otomatik yayilir (runtime zaten sunucudan cekiliyor).
# Sadece ileri-sarim (--ff-only); yerel sapma/cevrimdisi olursa MEVCUT kodla
# devam eder, agent'i ASLA bloklamaz. Gunluk 04:00 restart bunu her gun tekrarlar.
$RepoRoot = $null
try { $RepoRoot = (Resolve-Path (Join-Path $BaseDir '..\..')).Path } catch {}
function Update-Code {
    if (-not $RepoRoot) { return }
    if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { return }
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $git) { Write-Wrapper 'git bulunamadi, oto-guncelleme atlandi'; return }
    try {
        Push-Location $RepoRoot
        $out = & $git.Source pull --ff-only 2>&1
        Write-Wrapper "git pull: $($out -join ' | ')"
    } catch {
        Write-Wrapper "git pull atlandi (mevcut kodla devam): $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# Eski log dosyalarini ROTATE et (silmeden) - debug icin son crash kayitlari saklanir
foreach ($f in @($stdout, $stderr)) {
    if (Test-Path $f) {
        try {
            $info = Get-Item $f
            if ($info.Length -gt 5MB) {
                $rotated = "$f.old"
                if (Test-Path $rotated) { Remove-Item $rotated -Force -ErrorAction SilentlyContinue }
                Rename-Item $f $rotated -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }
}

Write-Wrapper "start-agent.ps1 baslatildi (PID=$PID)"

# TEK-WRAPPER GUVENCESI (2026-06-08): Onceden wrapper'in tek-ornek korumasi YOKTU.
# Cakisan gorevler + tekrar tetikleyiciler yuzunden ayni anda ONLARCA wrapper
# birikip surekli node baslatmaya calisiyordu (node tek-ornek kilidine takilip
# hemen cikiyor, wrapper backoff'la tekrar deniyor) = buyuk kaynak israfi + kaos.
# Named mutex ile makinede sadece TEK wrapper calisir; fazlalar hemen kapanir.
$wrapperMutexCreated = $false
$script:wrapperMutex = New-Object System.Threading.Mutex($true, 'Global\MorenLucaAgentWrapper', [ref]$wrapperMutexCreated)
if (-not $wrapperMutexCreated) {
    Write-Wrapper 'Baska wrapper zaten calisiyor; bu instance kapaniyor (tek-wrapper guvencesi).'
    exit 0
}

Update-Code

while ($true) {
    $lastStartTime = Get-Date
    Write-Wrapper "node src\agent.js baslatiliyor (crashCount=$crashCount)"

    $process = $null
    try {
        $process = Start-Process `
            -FilePath $node.Source `
            -ArgumentList 'src\agent.js' `
            -WorkingDirectory $BaseDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -PassThru `
            -Wait `
            -ErrorAction Stop
    } catch {
        Write-Wrapper "Start-Process HATASI: $($_.Exception.Message)"
        Start-Sleep -Seconds 10
        continue
    }

    $code = if ($process) { [int]$process.ExitCode } else { -1 }
    $runDuration = (Get-Date) - $lastStartTime

    Write-Wrapper "agent exit code=$code, run suresi=$([int]$runDuration.TotalSeconds)sn"

    # 5dk+ calismissa crash counter sifirla (saglikli calisma kabul et)
    if ($runDuration.TotalSeconds -gt 300) {
        $crashCount = 0
    } else {
        $crashCount++
    }

    $delay = Get-NextDelay $crashCount
    Write-Wrapper "$delay saniye sonra yeniden baslatiliyor (crashCount=$crashCount)"
    Start-Sleep -Seconds $delay
}
