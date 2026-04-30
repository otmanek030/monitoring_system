@echo off
title PhosWatch Rebuild
echo === PhosWatch Rebuild ===
cd /d C:\Users\OTHMANE\PFE\phoswatch

echo.
echo [1/5] Stopping containers...
docker compose down

echo.
echo [2/5] Removing stale build folder...
if exist "frontend\build" (
    rmdir /s /q "frontend\build"
    echo       Deleted frontend\build
)

echo.
echo [3/5] Removing old frontend image...
docker image rm phoswatch-frontend --force 2>nul

echo.
echo [4/5] Building frontend (takes 2-4 min)...
docker compose build --no-cache frontend
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed! Check errors above.
    pause
    exit /b 1
)

echo.
echo [5/5] Starting all services...
docker compose up -d

echo.
echo Waiting 8 seconds for services to start...
timeout /t 8 /nobreak >nul

echo.
echo === Container Status ===
docker compose ps

echo.
echo Done! Open http://localhost in your browser.
echo Press Ctrl+Shift+R in the browser to hard-refresh.
echo.
pause
