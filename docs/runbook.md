# Syncy Runbook

## Prerequisites
- Windows with PowerShell 7+
- Node.js 22+
- PNPM 9+
- Python 3.13
- FFmpeg + FFprobe in PATH

## Initial setup
```powershell
./scripts/setup.ps1
```

This installs workspace dependencies, creates `services/ai/.venv`, installs Python requirements, and pre-downloads Whisper `base.en`.

## Start dev stack
```powershell
./scripts/dev.ps1
```

- API: `http://127.0.0.1:3000`
- Web: `http://127.0.0.1:5173`

## Preflight
Use the UI preflight panel or call:
```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/preflight
```

## End-to-end smoke
```powershell
./scripts/smoke.ps1
```

The smoke script generates sample media, submits a job, waits for analysis + render, and verifies output duration.

## Troubleshooting
- If preflight fails model check: rerun `./scripts/setup.ps1`.
- If ffmpeg is missing: install FFmpeg and ensure `ffmpeg`/`ffprobe` are in PATH.
- If Python packages fail: delete `services/ai/.venv` and rerun setup.
- Job logs are written to `data/artifacts/<jobId>/logs.jsonl`.