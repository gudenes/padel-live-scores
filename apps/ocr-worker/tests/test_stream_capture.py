"""Tests for stream_capture.py — yt-dlp HLS playlist fetch.

Network-dependent test: marked as `slow` and skipped by default.
Run explicitly with `pytest -m slow tests/test_stream_capture.py`.
"""
import pytest

from src.stream_capture import fetch_latest_hls_segment


@pytest.mark.slow
def test_fetch_latest_segment_against_known_stream():
    """Smoke test: pull a segment from any public live stream.

    This test requires a live YouTube stream URL passed via env var.
    Skip if not set.
    """
    import os
    url = os.environ.get("OCR_TEST_LIVE_URL")
    if not url:
        pytest.skip("Set OCR_TEST_LIVE_URL to run this integration test")

    segment_bytes = fetch_latest_hls_segment(url)
    assert isinstance(segment_bytes, bytes)
    assert len(segment_bytes) > 10_000  # at least 10KB
