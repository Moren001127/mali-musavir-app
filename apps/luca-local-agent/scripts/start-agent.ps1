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
