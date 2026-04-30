# PhosWatch — Definitive clean rebuild
# Run from C:\Users\OTHMANE\PFE\phoswatch in PowerShell as Administrator

Write-Host "=== PhosWatch Rebuild ===" -ForegroundColor Cyan

# Step 1: Stop everything (NO -v, keeps database data)
Write-Host "`n[1/6] Stopping all containers..." -ForegroundColor Yellow
docker compose down
Write-Host "      Done" -ForegroundColor Green

# Step 2: Delete stale build folder that confuses Docker cache
Write-Host "`n[2/6] Removing stale build folder..." -ForegroundColor Yellow
if (Test-Path "frontend\build") {
    Remove-Item -Recurse -Force "frontend\build"
    Write-Host "      Deleted frontend\build" -ForegroundColor Green
} else {
    Write-Host "      No build folder found" -ForegroundColor Gray
}

# Step 3: Remove the old frontend image completely
Write-Host "`n[3/6] Removing old frontend image..." -ForegroundColor Yellow
docker image rm phoswatch-frontend --force 2>$null
Write-Host "      Done" -ForegroundColor Green

# Step 4: Prune dangling images to free space
Write-Host "`n[4/6] Pruning dangling images..." -ForegroundColor Yellow
docker image prune -f
Write-Host "      Done" -ForegroundColor Green

# Step 5: Rebuild frontend with absolutely no cache
Write-Host "`n[5/6] Building frontend from scratch (2-4 minutes)..." -ForegroundColor Yellow
docker compose build --no-cache frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Build failed! Check errors above." -ForegroundColor Red
    exit 1
}
Write-Host "      Build succeeded" -ForegroundColor Green

# Step 6: Start all services
Write-Host "`n[6/6] Starting all services..." -ForegroundColor Yellow
docker compose up -d
Write-Host "      Started" -ForegroundColor Green

# Wait and show status
Start-Sleep -Seconds 8
Write-Host "`n=== Container Status ===" -ForegroundColor Cyan
docker compose ps

Write-Host "`n✅ Done! Open http://localhost in your browser." -ForegroundColor Green
Write-Host "   Use Ctrl+Shift+R to hard-refresh and bypass browser cache." -ForegroundColor Gray
