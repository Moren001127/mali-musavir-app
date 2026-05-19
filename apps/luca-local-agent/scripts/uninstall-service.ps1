$ErrorActionPreference = 'Stop'

$TaskName = 'Luca Local Agent'

Write-Host ''
Write-Host "=== Luca Local Agent servisi kaldiriliyor ===" -ForegroundColor Cyan

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[OK] Task Scheduler gorevi silindi: $TaskName" -ForegroundColor Green
} else {
    Write-Host "[INFO] Task Scheduler gorevi zaten yok." -ForegroundColor Gray
}

$agentProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'src[\\/]agent\.js' }

foreach ($proc in $agentProcs) {
    try {
        Invoke-CimMethod -InputObject $proc -MethodName Terminate | Out-Null
        Write-Host "[OK] Calisan agent kapatildi. PID=$($proc.ProcessId)" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] PID $($proc.ProcessId) kapatilamadi: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ''
Read-Host 'Kapatmak icin Enter'
