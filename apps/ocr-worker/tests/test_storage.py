"""Tests for storage.py — selective frame retention to Supabase Storage."""
from unittest.mock import MagicMock

import numpy as np

from src.storage import maybe_retain_frame, FRAMES_BUCKET


def test_retain_when_below_confidence_threshold():
    """Low-confidence frames are always retained."""
    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.5, threshold=0.7,
        random_sample_rate=0.0,  # disable random sampling for this test
    )

    assert path is not None
    assert "42" in path
    supabase.storage.from_.assert_called_with(FRAMES_BUCKET)


def test_skip_when_above_threshold_and_no_sample():
    """High-confidence + no random hit = no retention."""
    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.9, threshold=0.7,
        random_sample_rate=0.0,
    )

    assert path is None
    supabase.storage.from_.assert_not_called()


def test_random_sample_retains_some_frames(monkeypatch):
    """1% sample rate retains a frame when random() returns 0.005."""
    import src.storage as storage_mod
    monkeypatch.setattr(storage_mod, "_random", lambda: 0.005)

    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.9, threshold=0.7,
        random_sample_rate=0.01,
    )
    assert path is not None
