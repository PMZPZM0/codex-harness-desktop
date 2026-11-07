@echo off
rem Harness shim: run qwenpaw through harness-qwenpaw.py (headless tools fix).
rem Kept in tools/cli-shims and placed before tools/python\Scripts in PATH.
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
