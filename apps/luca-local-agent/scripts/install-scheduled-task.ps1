$ErrorActionPreference = 'Stop'

$TaskName = 'Moren Luca Local Agent'
$BaseDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$StartScript = Join-Path $BaseDir 'scripts\start-agent.ps1'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"" `
  -WorkingDirectory $BaseDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 7) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Moren Luca Local Agent - Luca veri cekme worker' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started: $TaskName"
