"""Shared pytest fixtures for ocr-worker tests."""
from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    """Path to the test fixtures directory."""
    return FIXTURES_DIR


@pytest.fixture
def sample_calibration() -> dict:
    """A sample calibration matching `sample_full_frame.png`'s scoreboard."""
    return {
        "stream_label": "test_stream",
        "scoreboard_bbox": [50, 900, 600, 120],
        "row_layout": "two_pair_horizontal",
        "set_columns": [
            {"x": 350, "width": 40},
            {"x": 400, "width": 40},
        ],
        "game_column": {"x": 460, "width": 60},
        "pair_label_column": {"x": 10, "width": 320},
    }
