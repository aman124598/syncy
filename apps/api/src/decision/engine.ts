import type { AnalysisResult, TimeRange, TrimDecision, TrimStrategy } from "@syncy/shared";
import { AppError } from "../errors.js";
import {
  expandRange,
  intersectionLength,
  mergeRanges,
  overlaps,
  rangeLength,
  totalOverlapLength
} from "./range.js";

const SPEECH_PADDING_SEC = 0.35;
const OVERLAP_TOLERANCE_SEC = 0.02;

type DecisionInput = {
  videoDurationSec: number;
  targetDurationSec: number;
  analysis: AnalysisResult;
  hasReplacementAudio: boolean;
};

type Candidate = {
  strategy: TrimStrategy;
  keepRange: TimeRange;
  trimRanges: TimeRange[];
  reasoning: string[];
};

function overlapWithRanges(trimRanges: TimeRange[], ranges: TimeRange[]): number {
  return trimRanges.reduce((sum, trimRange) => {
    return sum + totalOverlapLength(trimRange, ranges);
  }, 0);
}

function silenceCoverage(trimRanges: TimeRange[], silenceRanges: TimeRange[]): number {
  const trimLength = trimRanges.reduce((sum, range) => sum + rangeLength(range), 0);
  if (trimLength === 0) {
    return 1;
  }
  const silenceOverlap = trimRanges.reduce((sum, trimRange) => {
    return (
      sum +
      silenceRanges.reduce((acc, silenceRange) => acc + intersectionLength(trimRange, silenceRange), 0)
    );
  }, 0);
  return Math.min(1, silenceOverlap / trimLength);
}

function hasInvalidRange(ranges: TimeRange[]): boolean {
  return ranges.some((range) => range.endSec <= range.startSec);
}

function buildCandidates(
  videoDurationSec: number,
  targetDurationSec: number,
  hasReplacementAudio: boolean
): Candidate[] {
  const trimNeededSec = Math.max(0, videoDurationSec - targetDurationSec);
  if (trimNeededSec <= 0) {
    return [
      {
        strategy: "outro",
        keepRange: { startSec: 0, endSec: videoDurationSec },
        trimRanges: [],
        reasoning: ["No trimming required because video already matches target duration."]
      }
    ];
  }

  const outroTrim = {
    startSec: Math.max(0, targetDurationSec),
    endSec: videoDurationSec
  };

  const candidates: Candidate[] = [
    {
      strategy: "outro",
      keepRange: { startSec: 0, endSec: targetDurationSec },
      trimRanges: [outroTrim],
      reasoning: ["Preferred outro trim candidate selected first."]
    }
  ];

  if (!hasReplacementAudio) {
    const introTrim = { startSec: 0, endSec: trimNeededSec };
    candidates.push({
      strategy: "intro",
      keepRange: {
        startSec: trimNeededSec,
        endSec: videoDurationSec
      },
      trimRanges: [introTrim],
      reasoning: ["No safe outro candidate found; evaluating intro trim."]
    });

    const introShare = trimNeededSec / 2;
    const outroShare = trimNeededSec - introShare;
    candidates.push({
      strategy: "intro_outro",
      keepRange: {
        startSec: introShare,
        endSec: videoDurationSec - outroShare
      },
      trimRanges: [
        { startSec: 0, endSec: introShare },
        { startSec: videoDurationSec - outroShare, endSec: videoDurationSec }
      ],
      reasoning: ["Balancing trim between intro and outro as secondary fallback."]
    });
  }

  return candidates.filter((candidate) => !hasInvalidRange(candidate.trimRanges));
}

function strategyBaseConfidence(strategy: TrimStrategy): number {
  switch (strategy) {
    case "outro":
      return 0.88;
    case "intro":
      return 0.78;
    case "intro_outro":
      return 0.72;
    case "fallback_low_density":
      return 0.62;
    default:
      return 0.6;
  }
}

function fallbackCandidate(
  videoDurationSec: number,
  targetDurationSec: number,
  analysis: AnalysisResult
): Candidate {
  const trimNeededSec = Math.max(0, videoDurationSec - targetDurationSec);
  const introTrim: TimeRange = { startSec: 0, endSec: trimNeededSec };
  const outroTrim: TimeRange = { startSec: targetDurationSec, endSec: videoDurationSec };

  const scoreFor = (range: TimeRange): number => {
    const lowInfoBonus = analysis.lowInfoRegions.reduce((sum, lowInfo) => {
      if (!overlaps(range, lowInfo)) {
        return sum;
      }
      return sum + intersectionLength(range, lowInfo) * lowInfo.score;
    }, 0);
    return -lowInfoBonus;
  };

  const introScore = scoreFor(introTrim);
  const outroScore = scoreFor(outroTrim);
  const pickOutro = outroScore <= introScore;

  return {
    strategy: "fallback_low_density",
    keepRange: pickOutro
      ? { startSec: 0, endSec: targetDurationSec }
      : { startSec: trimNeededSec, endSec: videoDurationSec },
    trimRanges: [pickOutro ? outroTrim : introTrim],
    reasoning: [
      "Fallback selected by lowest semantic-density edge region when rule-based candidates were blocked."
    ]
  };
}

function withinDuration(range: TimeRange, durationSec: number): boolean {
  return range.startSec >= 0 && range.endSec <= durationSec && range.endSec > range.startSec;
}

export function computeTrimDecision(input: DecisionInput): TrimDecision {
  const trimNeededSec = input.videoDurationSec - input.targetDurationSec;
  if (trimNeededSec < -0.01) {
    throw new AppError(
      "AUDIO_LONGER_THAN_VIDEO",
      "Replacement audio is longer than the source video. V1 only supports trimming excess video."
    );
  }

  const protectedRanges = mergeRanges(
    input.analysis.speechRegions.map((region) =>
      expandRange(region, SPEECH_PADDING_SEC, input.videoDurationSec)
    )
  );

  const candidates = buildCandidates(
    input.videoDurationSec,
    input.targetDurationSec,
    input.hasReplacementAudio
  );

  for (const candidate of candidates) {
    const speechOverlap = overlapWithRanges(candidate.trimRanges, protectedRanges);
    if (speechOverlap > OVERLAP_TOLERANCE_SEC) {
      continue;
    }

    const candidateTrimLength = candidate.trimRanges.reduce(
      (sum, trimRange) => sum + rangeLength(trimRange),
      0
    );
    const silenceScore = silenceCoverage(candidate.trimRanges, input.analysis.silenceRegions);
    const overlapRatio = candidateTrimLength > 0 ? speechOverlap / candidateTrimLength : 0;
    const confidence = Math.max(
      0,
      Math.min(
        1,
        strategyBaseConfidence(candidate.strategy) + silenceScore * 0.1 - overlapRatio * 0.5
      )
    );

    const reasoning = [
      ...candidate.reasoning,
      `Speech overlap across trim regions is ${speechOverlap.toFixed(2)}s.`,
      `Silence coverage of trim regions is ${(silenceScore * 100).toFixed(1)}%.`
    ];

    if (!withinDuration(candidate.keepRange, input.videoDurationSec)) {
      continue;
    }

    return {
      keepRange: candidate.keepRange,
      trimNeededSec: Math.max(0, trimNeededSec),
      strategy: candidate.strategy,
      confidence,
      reasoning,
      protectedRanges
    };
  }

  if (input.hasReplacementAudio) {
    throw new AppError(
      "NO_SYNC_SAFE_CUT",
      "No sync-safe tail trim candidate was found while preserving protected speech regions."
    );
  }

  const fallback = fallbackCandidate(input.videoDurationSec, input.targetDurationSec, input.analysis);
  const speechOverlap = overlapWithRanges(fallback.trimRanges, protectedRanges);
  const fallbackConfidence = Math.max(0.4, 0.62 - speechOverlap / Math.max(1, trimNeededSec));

  return {
    keepRange: fallback.keepRange,
    trimNeededSec: Math.max(0, trimNeededSec),
    strategy: fallback.strategy,
    confidence: Math.min(1, fallbackConfidence),
    reasoning: [
      ...fallback.reasoning,
      `Fallback overlap with protected speech is ${speechOverlap.toFixed(2)}s.`
    ],
    protectedRanges
  };
}
