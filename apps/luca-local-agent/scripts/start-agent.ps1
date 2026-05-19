$ErrorActionPreference = 'Stop'

$BaseDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $BaseDir

$node = Get-Command node.exe -ErrorAction Stop
$stdout = Join-Path $BaseDir 'agent.current.out.log'
$stderr = Join-Path $BaseDir 'agent.current.err.log'

$stamp = (Get-Date).ToString('s')
"[$stamp] start-agent.ps1: node src\agent.js" | Set-Content -Path $stdout -Encoding utf8
'' | Set-Content -Path $stderr -Encoding utf8

$process = Start-Process `
  -FilePath $node.Source `
  -ArgumentList 'src\agent.js' `
  -WorkingDirectory $BaseDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru `
  -Wait

exit $process.ExitCode
