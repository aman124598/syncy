import type { JobRecord, TimeRange } from "@syncy/shared";
import { AppError } from "./errors.js";

export function validateOverrideRange(job: JobRecord, keepRange: TimeRange): void {
  if (keepRange.startSec < 0 || keepRange.endSec > job.videoDurationSec) {
    throw new AppError("INVALID_OVERRIDE_RANGE", "Override range is outside video bounds.");
  }
  if (keepRange.endSec <= keepRange.startSec) {
    throw new AppError("INVALID_OVERRIDE_RANGE", "Override end must be greater than start.");
  }
  const duration = keepRange.endSec - keepRange.startSec;
  if (Math.abs(duration - job.targetDurationSec) > 0.25) {
    throw new AppError(
      "INVALID_OVERRIDE_RANGE",
      `Override duration must be within 0.25s of target ${job.targetDurationSec.toFixed(2)}s.`
    );
  }
  if (job.replacementAudioPath && keepRange.startSec > 0.001) {
    throw new AppError(
      "NO_SYNC_SAFE_CUT",
      "Replacement audio only supports tail-only ranges in V1."
    );
  }
}
