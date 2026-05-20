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

# Daily restart task — her gece 04:00'te agent prosesini sonlandir.
# Watchdog/scheduled task ana register'i hemen restart eder.
# RAM cache temizlenir, browser session sifirlanir.
$RestartTaskName = 'Moren Luca Agent Daily Restart'

$restartAction = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"Get-CimInstance Win32_Process -Filter ""Name='node.exe'"" | Where-Object {`$_.CommandLine -like '*luca-local-agent*'} | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName '$TaskName'`""

$restartTrigger = New-ScheduledTaskTrigger -Daily -At 4am
$restartSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $RestartTaskName `
  -Action $restartAction `
  -Trigger $restartTrigger `
  -Settings $restartSettings `
  -Principal $principal `
  -Description 'Her gece 04:00te Luca agent prosesini sonlandirip yeniden baslatir (RAM/session temizlik)' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started: $TaskName"
Write-Host "Daily restart scheduled: $RestartTaskName at 04:00"
