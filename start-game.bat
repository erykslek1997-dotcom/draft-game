@echo off
cd /d "%~dp0"
start "All-Time NBA Draft server" cmd /c "npm run dev"
timeout /t 3 /nobreak >nul
start http://localhost:5173
