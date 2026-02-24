from __future__ import annotations

import re
import subprocess
from typing import Any

_START_RE = re.compile(r"silence_start:\s*([0-9.]+)")
_END_RE = re.compile(r"silence_end:\s*([0-9.]+)")


def detect_silence_regions(
    video_path: str,
    ffmpeg_bin: str = "ffmpeg",
    noise_threshold: str = "-30dB",
    min_duration_sec: float = 0.3,
) -> list[dict[str, float]]:
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-i",
        video_path,
        "-af",
        f"silencedetect=noise={noise_threshold}:d={min_duration_sec}",
        "-f",
        "null",
        "-",
    ]

    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    output = process.stderr or ""
    regions: list[dict[str, float]] = []
    current_start: float | None = None

    for line in output.splitlines():
        start_match = _START_RE.search(line)
        if start_match:
            current_start = float(start_match.group(1))
            continue

        end_match = _END_RE.search(line)
        if end_match and current_start is not None:
            end_sec = float(end_match.group(1))
            if end_sec > current_start:
                regions.append(
                    {
                        "startSec": round(current_start, 3),
                        "endSec": round(end_sec, 3),
                    }
                )
            current_start = None

    return regions