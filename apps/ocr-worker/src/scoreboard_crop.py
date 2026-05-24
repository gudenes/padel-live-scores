"""Crop the scoreboard region from a video frame using per-stream calibration."""
import json
from pathlib import Path
from typing import Any

import numpy as np


def load_calibration(path: Path | str) -> dict[str, Any]:
    """Load a calibration JSON file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Calibration file not found: {p}")
    return json.loads(p.read_text())


def crop_scoreboard(frame: np.ndarray, calibration: dict[str, Any]) -> np.ndarray:
    """
    Crop the scoreboard region from a frame using calibration bbox.

    Args:
        frame: full video frame as np.ndarray of shape (H, W, 3) BGR.
        calibration: dict with 'scoreboard_bbox' = [x, y, width, height].

    Returns:
        Cropped region as a new np.ndarray view.

    Raises:
        ValueError: if bbox falls outside the frame.
        KeyError: if calibration is missing 'scoreboard_bbox'.
    """
    bbox = calibration["scoreboard_bbox"]
    x, y, w, h = bbox
    frame_h, frame_w = frame.shape[:2]

    if x < 0 or y < 0 or x + w > frame_w or y + h > frame_h:
        raise ValueError(
            f"bbox {bbox} out of frame bounds {frame_w}x{frame_h}"
        )

    return frame[y:y + h, x:x + w]
