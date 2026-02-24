Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$apiUrl = "http://127.0.0.1:3000"
$sampleDir = Join-Path $repoRoot "data/smoke"
New-Item -ItemType Directory -Path $sampleDir -Force | Out-Null

$videoPath = Join-Path $sampleDir "sample-video.mp4"
$audioPath = Join-Path $sampleDir "sample-audio.wav"

function Invoke-NativeQuiet {
  param(
    [string]$Executable,
    [string[]]$Arguments
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Executable @Arguments *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "$Executable exited with code $LASTEXITCODE"
    }
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

Write-Host "Generating sample media..."
Invoke-NativeQuiet -Executable "ffmpeg" -Arguments @(
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=1280x720:rate=30",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=44100",
  "-t",
  "12",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  $videoPath
)
Invoke-NativeQuiet -Executable "ffmpeg" -Arguments @(
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=44100",
  "-t",
  "8",
  $audioPath
)

Write-Host "Starting API server..."
$existingListeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($existingListeners) {
  foreach ($listener in $existingListeners) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "Building shared + API for smoke run..."
pnpm --filter @syncy/shared build | Out-Null
pnpm --filter @syncy/api build | Out-Null

$apiLog = Join-Path $sampleDir "api-smoke.log"
$apiErrLog = Join-Path $sampleDir "api-smoke.err.log"
$apiEntry = Join-Path $repoRoot "apps/api/dist/apps/api/src/index.js"
$apiProc = Start-Process -FilePath "node" -ArgumentList $apiEntry -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog

function Wait-ForApi {
  param([string]$Url)
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $resp = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 2
      if ($resp) { return }
    }
    catch {
      Start-Sleep -Milliseconds 1000
    }
  }
  throw "API did not become ready in time."
}

function Wait-ForStatus {
  param(
    [string]$JobId,
    [string[]]$DesiredStatuses,
    [int]$TimeoutSec = 240
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $job = Invoke-RestMethod -Uri "$apiUrl/api/jobs/$JobId" -Method Get
    if ($DesiredStatuses -contains $job.status) {
      return $job
    }
    Start-Sleep -Milliseconds 1200
  }
  throw "Timed out waiting for statuses: $($DesiredStatuses -join ', ')"
}

try {
  Wait-ForApi -Url $apiUrl
  Write-Host "Uploading sample job..."

  $form = @{
    video = Get-Item $videoPath
    replacementAudio = Get-Item $audioPath
  }
  $jobJson = & curl.exe -s -X POST -F "video=@$videoPath" -F "replacementAudio=@$audioPath" "$apiUrl/api/jobs"
  $job = $jobJson | ConvertFrom-Json
  Write-Host "Created job: $($job.id)"

  $job = Wait-ForStatus -JobId $job.id -DesiredStatuses @("awaiting_review", "failed")
  if ($job.status -eq "failed") {
    throw "Analysis failed: $($job.errorMessage)"
  }

  Write-Host "Queueing render..."
  Invoke-RestMethod -Uri "$apiUrl/api/jobs/$($job.id)/render" -Method Post | Out-Null

  $job = Wait-ForStatus -JobId $job.id -DesiredStatuses @("completed", "failed")
  if ($job.status -eq "failed") {
    throw "Render failed: $($job.errorMessage)"
  }

  $outputPath = Join-Path $repoRoot "data/outputs/$($job.id).mp4"
  if (-not (Test-Path $outputPath)) {
    throw "Output file missing: $outputPath"
  }

  $durationRaw = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $outputPath
  $durationSec = [double]$durationRaw
  if ([Math]::Abs($durationSec - 8.0) -gt 0.25) {
    throw "Output duration $durationSec is outside tolerance for target 8.0s"
  }

  Write-Host "Smoke test passed. Output: $outputPath"
}
catch {
  Write-Host "Smoke test failed: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) {
    Write-Host $_.ScriptStackTrace
  }
  throw
}
finally {
  if ($apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
