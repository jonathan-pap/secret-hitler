@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Make sure Node.js 18+ is installed.
    pause
    exit /b 1
  )
)
node server.js
pause
