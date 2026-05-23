@echo off
setlocal

set ROOT=%~dp0..\..
set COMPOSE_FILE=%ROOT%\docker\docker-compose.yml

echo === Building images ===
docker compose -f "%COMPOSE_FILE%" build

echo === Starting services (db + webhook + web-ui) ===
docker compose -f "%COMPOSE_FILE%" up -d

echo.
echo   web-ui:   http://localhost:8080
echo   webhook:  http://localhost:3100/health
echo   db:       postgres://trading:trading@localhost:5433/trading
echo.

echo === Waiting for health check...
:retry
timeout /t 2 /nobreak >nul
curl -sf http://localhost:8080/health >nul 2>&1
if %errorlevel% neq 0 goto retry

echo   Done.
pause
