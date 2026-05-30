# Plexus Development Environment Startup Script
# Run this script to start both backend and frontend in development mode

Write-Host "🚀 Starting Plexus Development Environment..." -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and configure it." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Run: Copy-Item .env.example .env" -ForegroundColor Yellow
    exit 1
}

# Check if Python virtual environment exists
if (-not (Test-Path "backend\venv")) {
    Write-Host "📦 Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv backend\venv
    Write-Host "✓ Virtual environment created" -ForegroundColor Green
}

# Check if Python dependencies are installed
Write-Host "📦 Installing Python dependencies..." -ForegroundColor Yellow
& backend\venv\Scripts\Activate.ps1
pip install -q -r backend\requirements.txt
Write-Host "✓ Python dependencies installed" -ForegroundColor Green

# Check if Node modules are installed
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "📦 Installing Node dependencies..." -ForegroundColor Yellow
    Set-Location frontend
    npm install
    Set-Location ..
    Write-Host "✓ Node dependencies installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎯 Starting services..." -ForegroundColor Cyan
Write-Host ""

# Start backend in new window
Write-Host "▶️  Starting backend on http://localhost:8000" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\backend'; .\venv\Scripts\Activate.ps1; uvicorn app.main:app --reload"

# Wait a moment for backend to start
Start-Sleep -Seconds 3

# Start frontend in new window
Write-Host "▶️  Starting frontend on http://localhost:3000" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\frontend'; npm run dev"

Write-Host ""
Write-Host "✓ Plexus is starting!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 Backend:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "📍 API Docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "📍 Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔐 Default Login:" -ForegroundColor Yellow
Write-Host "   Email:    admin@plexus.local" -ForegroundColor White
Write-Host "   Password: Admin@123456" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C in each window to stop the services." -ForegroundColor Gray
