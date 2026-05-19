Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = baseDir
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & baseDir & "\scripts\start-agent.ps1""", 0, False
