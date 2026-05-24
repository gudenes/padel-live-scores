"""Smoke test for main.py — one iteration with mocked dependencies."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np

from src.config import Config
from src.main import run_one_iteration


def _make_config() -> Config:
    return Config(
        supabase_url="https://t.supabase.co",
        supabase_service_key="k",
        stream_label="test",
        youtube_url="https://yt/abc",
        tournament_id="11111111-1111-1111-1111-111111111111",
        court_label="Pista Central",
        worker_version="abc",
    )


@patch("src.main.fetch_latest_hls_segment")
@patch("src.main.extract_last_frame")
@patch("src.main.crop_scoreboard")
@patch("src.main.run_ocr")
@patch("src.main.parse_score")
@patch("src.main.resolve_match_id")
@patch("src.main.write_snapshot")
@patch("src.main.maybe_retain_frame")
def test_run_one_iteration_happy_path(
    mock_retain, mock_write, mock_resolve, mock_parse,
    mock_ocr, mock_crop, mock_extract, mock_fetch,
):
    """Pipeline runs end-to-end, writes one snapshot."""
    mock_fetch.return_value = b"fake segment bytes"
    mock_extract.return_value = np.zeros((1080, 1920, 3), dtype=np.uint8)
    mock_crop.return_value = np.zeros((120, 600, 3), dtype=np.uint8)
    mock_ocr.return_value = ("COELLO 6 30\nGALAN 3 15", 0.85)
    mock_parse.return_value = {
        "sets_completed": ["6-3"], "current_game": "30-15",
        "pair1_label": "COELLO", "pair2_label": "GALAN", "parse_error": False,
    }
    mock_resolve.return_value = "match-uuid"
    mock_write.return_value = 42
    mock_retain.return_value = None

    config = _make_config()
    supabase = MagicMock()
    calibration = {"scoreboard_bbox": [50, 900, 600, 120]}

    snapshot_id = run_one_iteration(supabase, config, calibration)

    assert snapshot_id == 42
    mock_fetch.assert_called_once()
    mock_write.assert_called_once()
