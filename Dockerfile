FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

COPY . .

RUN pnpm install --frozen-lockfile

RUN python3 -m venv /app/services/ai/.venv \
    && /app/services/ai/.venv/bin/pip install --upgrade pip \
    && /app/services/ai/.venv/bin/pip install -r /app/services/ai/requirements.txt

RUN pnpm --filter @syncy/shared build && pnpm --filter @syncy/api build

RUN chmod +x /app/docker/start-backend.sh && mkdir -p /var/data

ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000
ENV PYTHON_PATH=/app/services/ai/.venv/bin/python
ENV AI_MODEL_SIZE=base.en
ENV AI_MODEL_DIR=/var/data/models
ENV DATA_ROOT=/var/data
ENV FFMPEG_BIN=ffmpeg
ENV FFPROBE_BIN=ffprobe
ENV CORS_ORIGIN=*

EXPOSE 3000

CMD ["/app/docker/start-backend.sh"]
