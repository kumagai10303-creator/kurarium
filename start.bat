@echo off
setlocal
cd /d "%~dp0backend"

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Please check the error above.
    pause
    exit /b 1
  )
)

echo Starting Kurarium backend (hidden)...
wscript "%~dp0start-hidden.vbs"
exit /b 0
