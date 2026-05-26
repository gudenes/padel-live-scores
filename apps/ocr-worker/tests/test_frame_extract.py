"""Integration test for frame_extract.py — uses recorded HLS segment."""
import numpy as np

from src.frame_extract import extract_last_frame


def test_extract_last_frame_returns_image(fixtures_dir):
    """Extract the last frame from a recorded .ts segment."""
    segment_path = fixtures_dir / "sample_segment.ts"
    segment_bytes = segment_path.read_bytes()

    frame = extract_last_frame(segment_bytes)

    assert isinstance(frame, np.ndarray)
    assert len(frame.shape) == 3  # H, W, 3 channels
    assert frame.shape[2] == 3
    assert frame.shape[0] > 100  # reasonable height
    assert frame.shape[1] > 100  # reasonable width
