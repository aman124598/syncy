from __future__ import annotations

from typing import Any

from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector


def detect_scene_cuts(video_path: str) -> list[float]:
    video = open_video(video_path)
    manager = SceneManager()
    manager.add_detector(ContentDetector())
    manager.detect_scenes(video=video, show_progress=False)
    scenes = manager.get_scene_list()

    if not scenes:
        return [0.0]

    cuts: list[float] = [0.0]
    for start_tc, _end_tc in scenes:
        cuts.append(round(start_tc.get_seconds(), 3))

    last_end = scenes[-1][1].get_seconds()
    cuts.append(round(last_end, 3))
    return sorted({max(0.0, value) for value in cuts})