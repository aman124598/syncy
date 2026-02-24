#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_PATH:-/app/services/ai/.venv/bin/python}"
MODEL_NAME="${AI_MODEL_SIZE:-base.en}"
MODEL_DIR="${AI_MODEL_DIR:-/var/data/models}"

mkdir -p "${MODEL_DIR}"

if [[ "${SKIP_MODEL_DOWNLOAD:-0}" != "1" ]]; then
  pushd /app/services/ai >/dev/null
  "${PYTHON_BIN}" -m ai_worker.download_model --model "${MODEL_NAME}" --model-dir "${MODEL_DIR}"
  popd >/dev/null
fi

exec node /app/apps/api/dist/apps/api/src/index.js
