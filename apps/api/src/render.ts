import fs from "node:fs";
import path from "node:path";
import type { TimeRange } from "@syncy/shared";
import { config, paths } from "./config.js";
import { AppError } from "./errors.js";
import { probeDurationSeconds } from "./media.js";
import { runProcess } from "./process.js";

export type RenderOptions = {
  videoPath: string;
  replacementAudioPath?: string;
  keepRange: TimeRange;
  videoDurationSec: number;
  targetDurationSec: number;
  outputPath: string;
  onProgress?: (progress: number, message?: string) => void;
  onLog?: (message: string) => void;
};

function parseFfmpegProgressSeconds(stderrChunk: string): number | null {
  const regex = /time=(\d{2}:\d{2}:\d{2}\.\d{2})/g;
  let match: RegExpExecArray | null = null;
  let latest: string | null = null;
  while (true) {
    match = regex.exec(stderrChunk);
    if (!match) {
      break;
    }
    latest = match[1];
  }
  if (!latest) {
    return null;
  }
  const [hh, mm, ss] = latest.split(":");
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function shouldUseStreamCopy(keepRange: TimeRange, replacementAudioPath?: string): boolean {
  return keepRange.startSec <= 0.001 && Boolean(keepRange.endSec > 0) && !replacementAudioPath;
}

function shouldUseStreamCopyWithReplacement(keepRange: TimeRange, replacementAudioPath?: string): boolean {
  return keepRange.startSec <= 0.001 && Boolean(replacementAudioPath);
}

export async function renderVideo(options: RenderOptions): Promise<{ outputPath: string; durationSec: number }> {
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });

  if (options.keepRange.startSec < 0 || options.keepRange.endSec > options.videoDurationSec) {
    throw new AppError("INVALID_OVERRIDE_RANGE", "Render range is outside video bounds.");
  }
  if (options.keepRange.endSec <= options.keepRange.startSec) {
    throw new AppError("INVALID_OVERRIDE_RANGE", "Render range must have positive duration.");
  }

  const useCopy = shouldUseStreamCopy(options.keepRange, options.replacementAudioPath);
  const useCopyWithReplacement = shouldUseStreamCopyWithReplacement(
    options.keepRange,
    options.replacementAudioPath
  );

  if (options.replacementAudioPath && options.keepRange.startSec > 0.001) {
    throw new AppError(
      "NO_SYNC_SAFE_CUT",
      "Replacement audio supports tail-only trims in V1 to preserve synchronization."
    );
  }

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "info"];

  if (useCopy) {
    args.push("-i", options.videoPath, "-to", `${options.keepRange.endSec}`, "-c", "copy", options.outputPath);
  } else if (useCopyWithReplacement) {
    args.push(
      "-i",
      options.videoPath,
      "-i",
      options.replacementAudioPath!,
      "-to",
      `${options.keepRange.endSec}`,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      options.outputPath
    );
  } else {
    args.push(
      "-i",
      options.videoPath,
      ...(options.replacementAudioPath ? ["-i", options.replacementAudioPath] : []),
      "-ss",
      `${options.keepRange.startSec}`,
      "-to",
      `${options.keepRange.endSec}`,
      "-map",
      "0:v:0",
      ...(options.replacementAudioPath ? ["-map", "1:a:0"] : ["-map", "0:a?"]),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      options.outputPath
    );
  }

  const expectedDuration = options.targetDurationSec;
  const result = await runProcess(config.ffmpegBin, args, {
    cwd: paths.repoRoot,
    onStderr: (chunk) => {
      options.onLog?.(chunk.trim());
      const seconds = parseFfmpegProgressSeconds(chunk);
      if (seconds === null) {
        return;
      }
      if (expectedDuration <= 0) {
        options.onProgress?.(1, "Rendering finished");
        return;
      }
      options.onProgress?.(
        Math.min(0.99, Math.max(0, seconds / expectedDuration)),
        "Rendering in progress"
      );
    }
  });

  if (result.code !== 0) {
    throw new AppError("RENDER_FAILED", result.stderr || result.stdout || "FFmpeg render failed.");
  }

  if (!fs.existsSync(options.outputPath)) {
    throw new AppError("RENDER_FAILED", "FFmpeg completed but output file was not produced.");
  }

  const renderedDurationSec = await probeDurationSeconds(options.outputPath);
  if (Math.abs(renderedDurationSec - expectedDuration) > 0.25) {
    throw new AppError(
      "RENDER_FAILED",
      `Output duration ${renderedDurationSec.toFixed(2)}s is outside tolerance for target ${expectedDuration.toFixed(2)}s.`
    );
  }

  options.onProgress?.(1, "Rendering complete");
  return {
    outputPath: options.outputPath,
    durationSec: renderedDurationSec
  };
}
