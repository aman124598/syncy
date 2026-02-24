from __future__ import annotations

import argparse
import os
import sys

from faster_whisper import WhisperModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download/check faster-whisper model cache")
    parser.add_argument("--model", default="base.en", help="Model name")
    parser.add_argument("--model-dir", required=True, help="Directory for model cache")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only verify that model is available locally",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.makedirs(args.model_dir, exist_ok=True)

    try:
        WhisperModel(
            args.model,
            device="cpu",
            compute_type="int8",
            download_root=args.model_dir,
            local_files_only=args.check_only,
        )
    except Exception as exc:  # pragma: no cover - runtime dependency failure
        sys.stderr.write(f"Model check/download failed: {exc}\n")
        return 1

    mode = "available" if args.check_only else "downloaded"
    sys.stdout.write(f"Model {args.model} is {mode} in {args.model_dir}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())