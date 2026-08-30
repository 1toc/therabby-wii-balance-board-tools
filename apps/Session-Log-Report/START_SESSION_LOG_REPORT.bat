@echo off
setlocal
start "" wscript.exe "%~dp0_app\_launch-hidden.vbs"
endlocal
exit /b 0
