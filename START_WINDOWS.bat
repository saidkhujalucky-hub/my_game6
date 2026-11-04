@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovi Node.js 20+ s https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Ustanovka zavisimostei...
  call npm install
  if errorlevel 1 (
    echo Oshibka npm install
    pause
    exit /b 1
  )
)
call npm run build
if errorlevel 1 (
  echo Oshibka sborki
  pause
  exit /b 1
)
start "HERO ISLANDS SERVER" cmd /k "npm start"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3001"
echo Server zapushen v otdelnom okne. Zakroi ego dlya ostanovki igry.
endlocal
