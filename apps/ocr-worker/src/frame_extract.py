"""Extract the last frame from an HLS .ts segment using ffmpeg."""
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def extract_last_frame(segment_bytes: bytes) -> np.ndarray:
    """
    Decode the last frame of a .ts HLS segment and return it as a BGR ndarray.

    Implementation note: uses ffmpeg with `-update 1` (overwrite same PNG per
    decoded frame) rather than seeking to EOF. The original plan specified
    `-sseof -0.05 -vframes 1` for fast seek-based extraction, but ffmpeg 8.1.1
    on MPEG-TS returns exit code 0 with zero frames written when using -sseof.

    The `-update 1` workaround is functionally correct (the final overwrite is
    always the last frame) but slower: it decodes the full segment (~120 frames
    at 30fps × 4s) instead of seeking, taking roughly 400-1500ms per call vs
    ~50ms for seek-based. Acceptable at the V1 polling rate of 1 frame per 3s,
    but revisit if either:
      - ffmpeg fixes the MPEG-TS -sseof bug (upgrade and switch back)
      - OCR throughput becomes the bottleneck in production
    """
    with tempfile.TemporaryDirectory() as tmp:
        seg_path = Path(tmp) / "segment.ts"
        png_path = Path(tmp) / "last.png"
        seg_path.write_bytes(segment_bytes)

        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i", str(seg_path),
                "-update", "1",
                "-loglevel", "error",
                str(png_path),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")

        if not png_path.exists():
            raise RuntimeError("ffmpeg produced no output frame")

        frame = cv2.imread(str(png_path))
        if frame is None:
            raise RuntimeError("Failed to read extracted frame")
        return frame
