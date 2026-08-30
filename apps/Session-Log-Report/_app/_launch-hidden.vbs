Option Explicit
Dim shell, fso, baseDir, serverPath, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverPath = fso.BuildPath(baseDir, "_server.ps1")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & serverPath & """"
shell.Run cmd, 0, False
