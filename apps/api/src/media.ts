import fs from "node:fs";
import { config } from "./config.js";
import { runProcess } from "./process.js";

export async function probeDurationSeconds(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file does not exist: ${filePath}`);
  }
  const result = await runProcess(config.ffprobeBin, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  if (result.code !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr || result.stdout}`);
  }
  const value = Number(result.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration from ffprobe for ${filePath}`);
  }
  return value;
}

export function clampRange(
  startSec: number,
  endSec: number,
  durationSec: number
): { startSec: number; endSec: number } {
  const start = Math.max(0, Math.min(durationSec, startSec));
  const end = Math.max(0, Math.min(durationSec, endSec));
  return { startSec: Math.min(start, end), endSec: Math.max(start, end) };
}
