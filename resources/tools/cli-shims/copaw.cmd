@echo off
rem Harness shim alias: qwenpaw ships both qwenpaw / copaw entry points.
setlocal
set "TOOLS=%~dp0.."
for %%P in ("%TOOLS%\python\python.exe" "python") do (
  "%%~P" -c "import qwenpaw" >nul 2>&1
  if not errorlevel 1 (
    "%%~P" "%TOOLS%\harness-qwenpaw.py" %*
    exit /b
  )
)
echo qwenpaw is not installed for any known Python. 1>&2
exit /b 127
