$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$logFile = Join-Path $dir "self-heal.log"

function Write-Log($message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
  Write-Host $line
  Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

Write-Log "=== HGS Agent Self-Heal started (PID: $PID) ==="

$existing = Get-WmiObject Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*hgs-agent.js*' }
foreach ($p in $existing) {
  Write-Log "Stopping old HGS Agent (PID: $($p.ProcessId))"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

while ($true) {
  Write-Log "Starting node hgs-agent.js ..."
  $proc = Start-Process -FilePath "node" -ArgumentList "hgs-agent.js" -WorkingDirectory $dir -NoNewWindow -PassThru -RedirectStandardOutput "agent.out.log" -RedirectStandardError "agent.err.log"
  Write-Log "HGS Agent started (PID: $($proc.Id))"
  $proc.WaitForExit()
  Write-Log "HGS Agent exited (ExitCode: $($proc.ExitCode)). Restart in 5s ..."
  Start-Sleep -Seconds 5
}
