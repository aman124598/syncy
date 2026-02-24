Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Set-Location $repoRoot

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

Write-Host "Installing PNPM workspace dependencies..."
pnpm install

$venvDir = Join-Path $repoRoot "services/ai/.venv"
if (-not (Test-Path $venvDir)) {
  Write-Host "Creating Python virtual environment at $venvDir"
  python -m venv $venvDir
}

$pythonExe = Join-Path $venvDir "Scripts/python.exe"
if (-not (Test-Path $pythonExe)) {
  throw "Python executable not found in virtual environment: $pythonExe"
}

Write-Host "Installing Python dependencies..."
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r "services/ai/requirements.txt"

Write-Host "Downloading/checking Whisper model cache..."
Push-Location "services/ai"
try {
  & $pythonExe -m ai_worker.download_model --model base.en --model-dir (Join-Path $repoRoot "services/ai/models")
}
finally {
  Pop-Location
}

Write-Host "Setup completed."