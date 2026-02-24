import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@syncy/shared";
import { computeTrimDecision } from "../src/decision/engine.js";

const baseAnalysis: AnalysisResult = {
  speechRegions: [],
  silenceRegions: [{ startSec: 6, endSec: 10 }],
  sceneCutsSec: [0, 3, 6, 10],
  lowInfoRegions: [{ startSec: 6, endSec: 10, score: 0.9 }],
  warnings: []
};

describe("computeTrimDecision", () => {
  it("prefers outro when safe", () => {
    const decision = computeTrimDecision({
      videoDurationSec: 10,
      targetDurationSec: 8,
      analysis: baseAnalysis,
      hasReplacementAudio: false
    });

    expect(decision.strategy).toBe("outro");
    expect(decision.keepRange.startSec).toBe(0);
    expect(decision.keepRange.endSec).toBe(8);
  });

  it("falls back from outro to intro when outro hits protected speech", () => {
    const decision = computeTrimDecision({
      videoDurationSec: 10,
      targetDurationSec: 8,
      analysis: {
        ...baseAnalysis,
        speechRegions: [{ startSec: 8.2, endSec: 9.8, text: "ending", confidence: 0.8 }]
      },
      hasReplacementAudio: false
    });

    expect(["intro", "intro_outro", "fallback_low_density"]).toContain(decision.strategy);
  });

  it("throws when replacement audio has no sync-safe tail cut", () => {
    expect(() =>
      computeTrimDecision({
        videoDurationSec: 10,
        targetDurationSec: 8,
        analysis: {
          ...baseAnalysis,
          speechRegions: [{ startSec: 7.4, endSec: 10, text: "spoken outro", confidence: 0.9 }]
        },
        hasReplacementAudio: true
      })
    ).toThrowError(/sync-safe/i);
  });
});