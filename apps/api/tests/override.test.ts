import { describe, expect, it } from "vitest";
import type { JobRecord } from "@syncy/shared";
import { validateOverrideRange } from "../src/override.js";

const job: JobRecord = {
  id: "job-1",
  status: "awaiting_review",
  videoPath: "video.mp4",
  videoDurationSec: 10,
  targetDurationSec: 8,
  deltaSec: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("validateOverrideRange", () => {
  it("accepts a valid range", () => {
    expect(() => validateOverrideRange(job, { startSec: 0, endSec: 8 })).not.toThrow();
  });

  it("rejects negative ranges", () => {
    expect(() => validateOverrideRange(job, { startSec: -1, endSec: 8 })).toThrowError(
      /outside video bounds/i
    );
  });

  it("rejects wrong duration", () => {
    expect(() => validateOverrideRange(job, { startSec: 1, endSec: 8 })).toThrowError(
      /within 0.25s/i
    );
  });

  it("enforces tail-only with replacement audio", () => {
    expect(() =>
      validateOverrideRange({ ...job, replacementAudioPath: "audio.wav" }, { startSec: 0.5, endSec: 8.5 })
    ).toThrowError(/tail-only/i);
  });
});