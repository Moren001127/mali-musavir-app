$ErrorActionPreference = 'Stop'

$BaseDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $BaseDir

$node = Get-Command node.exe -ErrorAction Stop
$stdout = Join-Path $BaseDir 'agent.current.out.log'
$stderr = Join-Path $BaseDir 'agent.current.err.log'

$restartableExitCodes = @(2, 3, 4)
$restartDelaySeconds = 5
$firstRun = $true

while ($true) {
  $stamp = (Get-Date).ToString('s')
  if ($firstRun) {
    "[$stamp] start-agent.ps1: node src\agent.js" | Set-Content -Path $stdout -Encoding utf8
    '' | Set-Content -Path $stderr -Encoding utf8
    $firstRun = $false
  } else {
    "[$stamp] start-agent.ps1: node src\agent.js" | Add-Content -Path $stdout -Encoding utf8
  }

  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList 'src\agent.js' `
    -WorkingDirectory $BaseDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru `
    -Wait

  $code = [int]$process.ExitCode
  if ($restartableExitCodes -notcontains $code) {
    exit $code
  }

  $line = "[$((Get-Date).ToString('s'))] start-agent.ps1: agent exit $code, $restartDelaySeconds sn sonra yeniden baslatiliyor"
  $line | Add-Content -Path $stderr -Encoding utf8
  Start-Sleep -Seconds $restartDelaySeconds
}
