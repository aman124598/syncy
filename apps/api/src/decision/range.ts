import type { TimeRange } from "@syncy/shared";

export function normalizeRange(range: TimeRange): TimeRange {
  if (range.startSec <= range.endSec) {
    return range;
  }
  return { startSec: range.endSec, endSec: range.startSec };
}

export function rangeLength(range: TimeRange): number {
  return Math.max(0, range.endSec - range.startSec);
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startSec < b.endSec && b.startSec < a.endSec;
}

export function intersectionLength(a: TimeRange, b: TimeRange): number {
  if (!overlaps(a, b)) {
    return 0;
  }
  return Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec);
}

export function expandRange(range: TimeRange, paddingSec: number, durationSec: number): TimeRange {
  return {
    startSec: Math.max(0, range.startSec - paddingSec),
    endSec: Math.min(durationSec, range.endSec + paddingSec)
  };
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = ranges
    .map(normalizeRange)
    .sort((a, b) => a.startSec - b.startSec)
    .filter((range) => range.endSec > range.startSec);

  if (sorted.length === 0) {
    return [];
  }

  const merged: TimeRange[] = [];
  let current = sorted[0];
  for (let idx = 1; idx < sorted.length; idx += 1) {
    const candidate = sorted[idx];
    if (candidate.startSec <= current.endSec) {
      current = {
        startSec: current.startSec,
        endSec: Math.max(current.endSec, candidate.endSec)
      };
    } else {
      merged.push(current);
      current = candidate;
    }
  }
  merged.push(current);
  return merged;
}

export function totalOverlapLength(range: TimeRange, protectedRanges: TimeRange[]): number {
  return protectedRanges.reduce((sum, protectedRange) => {
    return sum + intersectionLength(range, protectedRange);
  }, 0);
}
