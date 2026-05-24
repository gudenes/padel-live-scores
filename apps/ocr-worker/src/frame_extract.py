"""Extract the last frame from an HLS .ts segment using ffmpeg."""
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def extract_last_frame(segment_bytes: bytes) -> np.ndarray:
    """
    Decode the last frame of a .ts HLS segment and return it as a BGR ndarray.

    Uses ffmpeg via subprocess to seek to ~50ms before the end of the segment
    and dump that frame as PNG.
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
