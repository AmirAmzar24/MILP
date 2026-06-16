# Time-Space UI - Installation Script
# Run this once on a new machine after extracting the project.
# Usage: Double-click install.bat (recommended)
#        OR in PowerShell: .\install.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Time-Space UI - Installation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

function Check-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Abort($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# --- 1. Check Node.js ---
Write-Host "[1/4] Checking Node.js..." -ForegroundColor Yellow

if (-not (Check-Command "node")) {
    Write-Host "  Node.js is NOT installed." -ForegroundColor Red
    Write-Host "  Download and install Node.js v18+ from: https://nodejs.org/en/download" -ForegroundColor White
    Abort "Node.js is required. Install it then re-run this script."
}

$nodeVersion = node --version
Write-Host "  Node.js found: $nodeVersion" -ForegroundColor Green

if (-not (Check-Command "npm")) {
    Abort "npm not found. Reinstall Node.js from https://nodejs.org"
}

# --- 2. Check Python ---
Write-Host "[2/4] Checking Python..." -ForegroundColor Yellow

$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Check-Command $cmd) {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3\.(\d+)") {
            $minor = [int]$Matches[1]
            if ($minor -ge 10) {
                $pythonCmd = $cmd
                Write-Host "  Python found: $ver ($cmd)" -ForegroundColor Green
                break
            }
        }
    }
}

if (-not $pythonCmd) {
    Write-Host "  Python 3.10+ is NOT installed (or not found in PATH)." -ForegroundColor Red
    Write-Host "  Download Python 3.12 from: https://www.python.org/downloads" -ForegroundColor White
    Write-Host "  IMPORTANT: During install, check 'Add Python to PATH'." -ForegroundColor Yellow
    Abort "Python 3.10+ is required. Install it then re-run this script."
}

# --- 3. Install Python dependencies ---
Write-Host "[3/4] Installing Python dependencies..." -ForegroundColor Yellow

$reqFile = Join-Path $projectRoot "requirements.txt"
if (-not (Test-Path $reqFile)) {
    Abort "requirements.txt not found in $projectRoot"
}

try {
    & $pythonCmd -m pip install --upgrade pip --quiet
    & $pythonCmd -m pip install -r $reqFile
    Write-Host "  Python dependencies installed." -ForegroundColor Green
} catch {
    Abort "pip install failed. Error: $_"
}

# --- 4. Install Node.js frontend dependencies ---
Write-Host "[4/4] Installing Node.js frontend dependencies..." -ForegroundColor Yellow

$frontendDir = Join-Path $projectRoot "time-space-ui"
if (-not (Test-Path $frontendDir)) {
    Abort "time-space-ui folder not found in $projectRoot"
}

Push-Location $frontendDir
try {
    npm install
    Write-Host "  Node dependencies installed." -ForegroundColor Green
} catch {
    Abort "npm install failed. Error: $_"
} finally {
    Pop-Location
}

# --- 5. Set up .env file ---
Write-Host ""
Write-Host "Setting up environment config..." -ForegroundColor Yellow

$envFile    = Join-Path $projectRoot ".env"
$envExample = Join-Path $projectRoot ".env.example"

if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "  Created .env from .env.example" -ForegroundColor Green
        Write-Host "  IMPORTANT: Open .env and fill in MONGO_URI and other settings." -ForegroundColor Yellow
    } else {
        Write-Host "  Warning: No .env.example found. Create .env manually." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  .env already exists - skipping." -ForegroundColor DarkGray
}

# --- 6. Create launcher scripts ---
Write-Host ""
Write-Host "Creating launcher scripts..." -ForegroundColor Yellow

$startBackend = @'
# Start the Flask backend API
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot
Write-Host "Starting backend API on http://localhost:5000 ..." -ForegroundColor Cyan
python APIs/frontendAPI.py
'@

$startFrontend = @'
# Start the Vite frontend dev server
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $projectRoot "time-space-ui")
Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Cyan
npm run dev
'@

$startAll = @'
# Start both backend and frontend in separate windows
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Launching backend and frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-ExecutionPolicy","Bypass","-NoExit","-File","`"$projectRoot\start-backend.ps1`""
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-ExecutionPolicy","Bypass","-NoExit","-File","`"$projectRoot\start-frontend.ps1`""
Write-Host ""
Write-Host "Both servers starting in separate windows." -ForegroundColor Green
Write-Host "  Backend:  http://localhost:5000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "Open browser at http://localhost:5173" -ForegroundColor Cyan
'@

Set-Content -Path (Join-Path $projectRoot "start-backend.ps1")  -Value $startBackend  -Encoding ASCII
Set-Content -Path (Join-Path $projectRoot "start-frontend.ps1") -Value $startFrontend -Encoding ASCII
Set-Content -Path (Join-Path $projectRoot "start-all.ps1")      -Value $startAll      -Encoding ASCII

$batBackend  = "@echo off`r`npowershell -ExecutionPolicy Bypass -File `"%~dp0start-backend.ps1`"`r`npause"
$batFrontend = "@echo off`r`npowershell -ExecutionPolicy Bypass -File `"%~dp0start-frontend.ps1`"`r`npause"
$batAll      = "@echo off`r`npowershell -ExecutionPolicy Bypass -File `"%~dp0start-all.ps1`"`r`npause"

Set-Content -Path (Join-Path $projectRoot "start-backend.bat")  -Value $batBackend  -Encoding ASCII
Set-Content -Path (Join-Path $projectRoot "start-frontend.bat") -Value $batFrontend -Encoding ASCII
Set-Content -Path (Join-Path $projectRoot "start-all.bat")      -Value $batAll      -Encoding ASCII

Write-Host "  Created start-backend.ps1 / .bat" -ForegroundColor Green
Write-Host "  Created start-frontend.ps1 / .bat" -ForegroundColor Green
Write-Host "  Created start-all.ps1 / .bat" -ForegroundColor Green

# --- Done ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Open .env and fill in MONGO_URI and ALLOWED_ORIGINS" -ForegroundColor Yellow
Write-Host "  2. Double-click start-all.bat to launch the app" -ForegroundColor Yellow
Write-Host "  3. Open browser at http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to exit"
