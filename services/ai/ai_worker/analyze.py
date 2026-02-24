from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from typing import Any

from faster_whisper import WhisperModel

from .scene import detect_scene_cuts
from .silence import detect_silence_regions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a video for trim-safe regions.")
    parser.add_argument("--video", required=True, help="Input video path")
    parser.add_argument("--work-dir", required=True, help="Working directory")
    parser.add_argument("--out", required=True, help="Output JSON path")
    parser.add_argument("--model", default="base.en", help="Whisper model name")
    parser.add_argument("--model-dir", required=True, help="Whisper model cache directory")
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="Path to ffmpeg")
    parser.add_argument("--ffprobe-bin", default="ffprobe", help="Path to ffprobe")
    return parser.parse_args()


def probe_duration(video_path: str, ffprobe_bin: str) -> float:
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr or result.stdout}")
    duration = float(result.stdout.strip())
    if duration <= 0:
        raise RuntimeError("ffprobe returned non-positive duration")
    return duration


def overlap_len(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    start = max(start_a, start_b)
    end = min(end_a, end_b)
    return max(0.0, end - start)


def detect_speech_regions(video_path: str, model_name: str, model_dir: str) -> list[dict[str, Any]]:
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        download_root=model_dir,
    )
    segments, _info = model.transcribe(
        video_path,
        language="en",
        vad_filter=True,
        beam_size=1,
        temperature=0.0,
    )

    results: list[dict[str, Any]] = []
    for segment in segments:
        start_sec = float(segment.start)
        end_sec = float(segment.end)
        if end_sec <= start_sec:
            continue
        avg_logprob = float(getattr(segment, "avg_logprob", -1.0))
        confidence = max(0.0, min(1.0, 1.0 + avg_logprob / 5.0))
        results.append(
            {
                "startSec": round(start_sec, 3),
                "endSec": round(end_sec, 3),
                "text": str(segment.text).strip(),
                "confidence": round(confidence, 3),
            }
        )

    return sorted(results, key=lambda item: (item["startSec"], item["endSec"]))


def build_low_info_regions(
    duration_sec: float,
    silence_regions: list[dict[str, float]],
    scene_cuts_sec: list[float],
    speech_regions: list[dict[str, Any]],
) -> list[dict[str, float]]:
    candidates: list[dict[str, float]] = []

    for silence in silence_regions:
        start = silence["startSec"]
        end = silence["endSec"]
        length = max(0.0, end - start)
        if length < 0.4:
            continue
        score = min(1.0, 0.55 + min(0.35, length / 8.0))
        candidates.append(
            {
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "score": round(score, 3),
            }
        )

    cuts = sorted({max(0.0, min(duration_sec, value)) for value in scene_cuts_sec})
    if not cuts or cuts[0] > 0:
        cuts = [0.0, *cuts]
    if cuts[-1] < duration_sec:
        cuts.append(duration_sec)

    for idx in range(len(cuts) - 1):
        start = cuts[idx]
        end = cuts[idx + 1]
        length = max(0.0, end - start)
        if length < 0.8:
            continue

        speech_overlap = 0.0
        for speech in speech_regions:
            speech_overlap += overlap_len(start, end, speech["startSec"], speech["endSec"])
        speech_coverage = speech_overlap / length

        if speech_coverage > 0.2:
            continue

        score = min(1.0, 0.4 + (1.0 - speech_coverage) * 0.45 + min(0.15, length / 12.0))
        candidates.append(
            {
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "score": round(score, 3),
            }
        )

    if not candidates:
        return []

    candidates.sort(key=lambda item: (item["startSec"], item["endSec"]))
    merged: list[dict[str, float]] = [candidates[0]]
    for current in candidates[1:]:
        last = merged[-1]
        if current["startSec"] <= last["endSec"]:
            merged[-1] = {
                "startSec": last["startSec"],
                "endSec": max(last["endSec"], current["endSec"]),
                "score": round(max(last["score"], current["score"]), 3),
            }
        else:
            merged.append(current)

    return merged


def main() -> int:
    args = parse_args()
    os.makedirs(args.work_dir, exist_ok=True)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    os.makedirs(args.model_dir, exist_ok=True)

    warnings: list[str] = []

    try:
        duration_sec = probe_duration(args.video, args.ffprobe_bin)
    except Exception as exc:  # pragma: no cover - dependency/system issue
        sys.stderr.write(f"Duration probe failed: {exc}\n")
        return 1

    try:
        speech_regions = detect_speech_regions(args.video, args.model, args.model_dir)
    except Exception as exc:  # pragma: no cover - dependency/system issue
        sys.stderr.write(f"Speech analysis failed: {exc}\n")
        return 1

    try:
        silence_regions = detect_silence_regions(args.video, ffmpeg_bin=args.ffmpeg_bin)
    except Exception as exc:
        silence_regions = []
        warnings.append(f"Silence detection failed: {exc}")

    try:
        scene_cuts = detect_scene_cuts(args.video)
    except Exception as exc:
        scene_cuts = [0.0, round(duration_sec, 3)]
        warnings.append(f"Scene detection failed: {exc}")

    if not scene_cuts:
        scene_cuts = [0.0, round(duration_sec, 3)]

    low_info_regions = build_low_info_regions(duration_sec, silence_regions, scene_cuts, speech_regions)

    payload = {
        "speechRegions": speech_regions,
        "silenceRegions": silence_regions,
        "sceneCutsSec": sorted({round(max(0.0, value), 3) for value in scene_cuts}),
        "lowInfoRegions": low_info_regions,
        "warnings": warnings,
    }

    with open(args.out, "w", encoding="utf-8") as out_file:
        json.dump(payload, out_file, indent=2)

    sys.stdout.write(f"Analysis completed for {args.video}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())