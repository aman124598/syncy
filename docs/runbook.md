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

## Deploy backend on Render (Docker)
- Render service type: `Web Service` using `Docker`.
- Use at least Render `starter` plan (persistent disks are not available on free web services).
- Use repo root `Dockerfile`.
- Mount a persistent disk at `/var/data` (recommended for SQLite, uploads, outputs, and model cache).
- Set backend env vars in Render:
  - `APP_HOST=0.0.0.0`
  - `APP_PORT=3000`
  - `PYTHON_PATH=/app/services/ai/.venv/bin/python`
  - `AI_MODEL_SIZE=base.en`
  - `AI_MODEL_DIR=/var/data/models`
  - `DATA_ROOT=/var/data`
  - `FFMPEG_BIN=ffmpeg`
  - `FFPROBE_BIN=ffprobe`
  - `CORS_ORIGIN=https://<your-vercel-domain>`

`render.yaml` is included for blueprint-based setup.

## Deploy frontend on Vercel
- Import this repo in Vercel.
- Use root-level `vercel.json` or set equivalent in project settings.
- Add env var:
  - `VITE_API_BASE=https://<your-render-backend-domain>`
- Redeploy after setting the env var.

## Troubleshooting
- If preflight fails model check: rerun `./scripts/setup.ps1`.
- If ffmpeg is missing: install FFmpeg and ensure `ffmpeg`/`ffprobe` are in PATH.
- If Python packages fail: delete `services/ai/.venv` and rerun setup.
- Job logs are written to `data/artifacts/<jobId>/logs.jsonl`.
