# API Reference

Base URL: `http://127.0.0.1:3000`

## `GET /api/preflight`
Returns dependency readiness checks.

## `GET /api/health`
Lightweight liveness endpoint used by scripts.

## `POST /api/jobs`
Multipart upload endpoint.
- Required file field: `video`
- Optional file field: `replacementAudio`

Response: job object with status and media URLs.

## `GET /api/jobs/:id`
Returns full job state:
- durations
- decision + confidence + reasoning
- manual override
- output path/status

## `GET /api/jobs/:id/events`
SSE stream of status/progress/log/error/complete events.

## `PATCH /api/jobs/:id/override`
JSON body:
```json
{ "keepStartSec": 0, "keepEndSec": 8.0 }
```
Validation:
- must stay in bounds
- must match target duration within 0.25s
- when replacement audio exists, start must be 0 (tail-only)

## `POST /api/jobs/:id/render`
Queues render execution using override range if present, else AI suggestion.

## `GET /api/jobs/:id/output`
Downloads rendered MP4 once available.

## Media URLs
- Source uploads: `/media/uploads/<jobId>/<filename>`
- Outputs: `/media/outputs/<jobId>.mp4`
