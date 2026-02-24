import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  const root = path.parse(startDir).root;
  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) &&
      fs.existsSync(path.join(current, "package.json"))
    ) {
      return current;
    }
    if (current === root) {
      return startDir;
    }
    current = path.dirname(current);
  }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = findRepoRoot(path.resolve(moduleDir, "../../.."));
dotenv.config({ path: path.join(defaultRepoRoot, ".env") });

export const config = {
  repoRoot: process.env.SYNCY_ROOT
    ? path.resolve(process.env.SYNCY_ROOT)
    : defaultRepoRoot,
  host: process.env.APP_HOST ?? "127.0.0.1",
  port: Number(process.env.APP_PORT ?? "3000"),
  webPort: Number(process.env.WEB_PORT ?? "5173"),
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
  ffprobeBin: process.env.FFPROBE_BIN ?? "ffprobe",
  pythonPath:
    process.env.PYTHON_PATH ?? "services/ai/.venv/Scripts/python.exe",
  aiModelSize: process.env.AI_MODEL_SIZE ?? "base.en",
  aiModelDir: process.env.AI_MODEL_DIR ?? "services/ai/models",
  dataRoot: process.env.DATA_ROOT ?? "data",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "512"),
  jobConcurrency: Math.max(1, Number(process.env.JOB_CONCURRENCY ?? "1"))
};

export const paths = {
  repoRoot: config.repoRoot,
  dataRoot: path.resolve(config.repoRoot, config.dataRoot),
  uploadsRoot: path.resolve(config.repoRoot, config.dataRoot, "uploads"),
  workRoot: path.resolve(config.repoRoot, config.dataRoot, "work"),
  outputsRoot: path.resolve(config.repoRoot, config.dataRoot, "outputs"),
  artifactsRoot: path.resolve(config.repoRoot, config.dataRoot, "artifacts"),
  dbPath: path.resolve(config.repoRoot, config.dataRoot, "app.db"),
  aiRoot: path.resolve(config.repoRoot, "services/ai"),
  aiModelDir: path.resolve(config.repoRoot, config.aiModelDir)
};

for (const dir of [
  paths.dataRoot,
  paths.uploadsRoot,
  paths.workRoot,
  paths.outputsRoot,
  paths.artifactsRoot
]) {
  fs.mkdirSync(dir, { recursive: true });
}
