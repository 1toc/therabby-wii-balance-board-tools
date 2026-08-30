Option Explicit
Dim shell, fso, rootDir, launcher
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(fso.BuildPath(rootDir, "_app"), "_launch-hidden.vbs")
shell.Run "wscript.exe """ & launcher & """", 0, False
