# Syncy

AI-assisted, context-aware video trimming with local-first processing.

Syncy analyzes video + optional replacement audio, suggests a safe trim range using speech/silence/scene signals, lets users override manually, and renders the final output with FFmpeg.

## What It Does

- Detects duration mismatch between video and target audio.
- Protects speech-heavy segments using Whisper timestamps.
- Uses silence + scene boundaries to propose low-risk cuts.
- Applies deterministic trim rules with confidence + reasoning.
- Supports manual keep-range override before final render.
- Runs fully local in development (no cloud AI dependency).

## Tech Stack

- Frontend: React + Vite + TypeScript (`apps/web`)
- Backend: Node.js + Express + TypeScript (`apps/api`)
- AI worker: Python 3.13 + `faster-whisper` + `scenedetect` (`services/ai`)
- Media: FFmpeg + FFprobe
- Metadata: SQLite + local filesystem artifacts

## Monorepo Layout

```text
apps/
  api/        # Orchestrator API + queue + render engine
  web/        # Upload/review/render UI
packages/
  shared/     # Shared types and zod schemas
services/
  ai/         # Python analysis worker
scripts/
  setup.ps1   # Installs deps + model
  dev.ps1     # Runs API + web
  smoke.ps1   # End-to-end smoke test
docs/
  runbook.md
  api.md
```

## Local Quick Start (Windows)

Prereqs:
- Node.js 22+
- PNPM 9+
- Python 3.13
- FFmpeg + FFprobe in `PATH`

Commands:

```powershell
pnpm setup
pnpm dev
```

App URLs:
- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3000`

## Environment Variables

Default template is in `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | API bind host |
| `APP_PORT` | `3000` | API port |
| `WEB_PORT` | `5173` | Local web dev port |
| `CORS_ORIGIN` | `http://127.0.0.1:5173` | Allowed frontend origins (comma-separated or `*`) |
| `PYTHON_PATH` | `services/ai/.venv/Scripts/python.exe` | Python runtime for AI worker |
| `AI_MODEL_SIZE` | `base.en` | Whisper model name |
| `AI_MODEL_DIR` | `services/ai/models` | Whisper model cache path |
| `MAX_UPLOAD_MB` | `512` | Upload size limit |
| `JOB_CONCURRENCY` | `1` | Concurrent processing jobs |
| `DATA_ROOT` | `data` | Storage root for DB/uploads/outputs |
| `FFMPEG_BIN` | `ffmpeg` | FFmpeg executable |
| `FFPROBE_BIN` | `ffprobe` | FFprobe executable |

## API Snapshot

- `GET /api/health`
- `GET /api/preflight`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/events`
- `PATCH /api/jobs/:id/override`
- `POST /api/jobs/:id/render`
- `GET /api/jobs/:id/output`

See full contract in `docs/api.md`.

## Deployment: Render (API) + Vercel (Web)

This repo is pre-wired for that split deployment.

Backend (Render):
- Uses root `Dockerfile`.
- Uses `render.yaml` blueprint.
- Expects persistent disk mounted at `/var/data`.
- Set `CORS_ORIGIN=https://<your-vercel-domain>`.

Frontend (Vercel):
- Uses root `vercel.json` with Vite build output at `apps/web/dist`.
- Set `VITE_API_BASE=https://<your-render-backend-domain>`.

Detailed deployment steps are in `docs/runbook.md`.

## Validation Commands

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

## Operational Notes

- Current version is single-user and unauthenticated.
- For internet exposure, add auth/rate limiting and storage lifecycle cleanup.
- Job logs are written to `data/artifacts/<jobId>/logs.jsonl`.

