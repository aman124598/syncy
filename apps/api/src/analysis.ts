import fs from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "@syncy/shared";
import { analysisResultSchema } from "@syncy/shared";
import { config, paths } from "./config.js";
import { runProcess } from "./process.js";

export type AnalyzeOptions = {
  videoPath: string;
  workDir: string;
  outputPath: string;
  onLog?: (line: string) => void;
};

export async function runAnalysis(options: AnalyzeOptions): Promise<AnalysisResult> {
  fs.mkdirSync(options.workDir, { recursive: true });
  const pythonPath = path.resolve(config.repoRoot, config.pythonPath);
  const args = [
    "-m",
    "ai_worker.analyze",
    "--video",
    options.videoPath,
    "--work-dir",
    options.workDir,
    "--out",
    options.outputPath,
    "--model",
    config.aiModelSize,
    "--model-dir",
    paths.aiModelDir,
    "--ffmpeg-bin",
    config.ffmpegBin,
    "--ffprobe-bin",
    config.ffprobeBin
  ];

  const result = await runProcess(pythonPath, args, {
    cwd: paths.aiRoot,
    onStdout: (chunk) => options.onLog?.(chunk.trim()),
    onStderr: (chunk) => options.onLog?.(chunk.trim())
  });

  if (result.code !== 0) {
    throw new Error(`AI analysis failed: ${result.stderr || result.stdout}`);
  }

  if (!fs.existsSync(options.outputPath)) {
    throw new Error(`AI analysis output missing at ${options.outputPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(options.outputPath, "utf8"));
  return analysisResultSchema.parse(payload);
}
