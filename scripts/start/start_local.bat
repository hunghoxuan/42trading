@echo off
setlocal

set ROOT=%~dp0..\..
set WEB_API_DIR=%ROOT%\src/api
set WEB_UI_DIR=%ROOT%\src/admin
set VITE_PORT=3000
set WEBHOOK_PORT=3001

echo === Starting web-api on :%WEBHOOK_PORT% ===
start "web-api" cmd /c "cd /d %ROOT% && set PORT=%WEBHOOK_PORT% && node --watch src/api/app/server.js"

timeout /t 2 /nobreak >nul

echo === Starting Vite on :%VITE_PORT% ===
start "vite" cmd /c "cd /d %WEB_UI_DIR% && set VITE_API_PROXY_TARGET=http://127.0.0.1:%WEBHOOK_PORT% && npx vite --port %VITE_PORT% --strictPort"

echo.
echo === Open http://localhost:%VITE_PORT% ===
echo.
pause
