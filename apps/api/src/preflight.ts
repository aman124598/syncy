import fs from "node:fs";
import path from "node:path";
import type { PreflightResponse } from "@syncy/shared";
import { config, paths } from "./config.js";
import { runProcess } from "./process.js";

type Check = {
  name: string;
  ok: boolean;
  details: string;
};

async function checkCommand(name: string, command: string, args: string[]): Promise<Check> {
  try {
    const result = await runProcess(command, args);
    if (result.code !== 0) {
      return {
        name,
        ok: false,
        details: (result.stderr || result.stdout || "command failed").trim()
      };
    }
    const line = (result.stdout || result.stderr).split(/\r?\n/).find(Boolean) ?? "ok";
    return { name, ok: true, details: line.trim() };
  } catch (error) {
    return {
      name,
      ok: false,
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkModelAvailability(): Promise<Check> {
  const pythonPath = path.resolve(config.repoRoot, config.pythonPath);
  if (!fs.existsSync(pythonPath)) {
    return {
      name: "whisper-model",
      ok: false,
      details: `Python venv not found at ${pythonPath}`
    };
  }
  try {
    const result = await runProcess(pythonPath, [
      "-m",
      "ai_worker.download_model",
      "--model",
      config.aiModelSize,
      "--model-dir",
      paths.aiModelDir,
      "--check-only"
    ], {
      cwd: paths.aiRoot
    });
    if (result.code !== 0) {
      return {
        name: "whisper-model",
        ok: false,
        details: (result.stderr || result.stdout || "model check failed").trim()
      };
    }
    return {
      name: "whisper-model",
      ok: true,
      details: result.stdout.trim() || `Model ${config.aiModelSize} available`
    };
  } catch (error) {
    return {
      name: "whisper-model",
      ok: false,
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runPreflight(): Promise<PreflightResponse> {
  const checks: Check[] = [];
  checks.push(await checkCommand("ffmpeg", config.ffmpegBin, ["-version"]));
  checks.push(await checkCommand("ffprobe", config.ffprobeBin, ["-version"]));
  checks.push(
    await checkCommand("python", path.resolve(config.repoRoot, config.pythonPath), ["--version"])
  );
  checks.push(await checkModelAvailability());

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}
