"""Selective frame retention to Supabase Storage 'ocr-frames' bucket."""
from random import random as _random
from typing import Any, Optional

import cv2
import numpy as np


FRAMES_BUCKET = "ocr-frames"
DEFAULT_SAMPLE_RATE = 0.01


def maybe_retain_frame(
    supabase: Any,
    frame: np.ndarray,
    snapshot_id: int,
    confidence: float,
    threshold: float = 0.7,
    random_sample_rate: float = DEFAULT_SAMPLE_RATE,
) -> Optional[str]:
    """
    Decide whether to upload `frame` to Supabase Storage, and do so if yes.

    Retains if:
      - confidence < threshold (low-confidence debug case), OR
      - random sample hits (random() < random_sample_rate)

    Returns the storage path on retention, or None if skipped.
    Uploads as PNG.
    """
    should_retain = (confidence < threshold) or (_random() < random_sample_rate)
    if not should_retain:
        return None

    success, png_bytes = cv2.imencode(".png", frame)
    if not success:
        raise RuntimeError("Failed to encode frame as PNG")

    path = f"snapshots/{snapshot_id}.png"
    supabase.storage.from_(FRAMES_BUCKET).upload(
        path=path,
        file=png_bytes.tobytes(),
        file_options={"content-type": "image/png"},
    )
    return path
