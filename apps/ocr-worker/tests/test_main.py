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


@patch("src.main.fetch_latest_hls_segment")
@patch("src.main.extract_last_frame")
@patch("src.main.ocr_columnar")
@patch("src.main.crop_scoreboard")
@patch("src.main.run_ocr")
@patch("src.main.parse_score")
@patch("src.main.resolve_match_id")
@patch("src.main.write_snapshot")
@patch("src.main.maybe_retain_frame")
def test_run_one_iteration_uses_columnar_when_calibration_has_columns(
    mock_retain, mock_write, mock_resolve, mock_parse, mock_run_ocr,
    mock_crop, mock_ocr_columnar, mock_extract, mock_fetch,
):
    """V1.1 path: when calibration declares column metadata, use ocr_columnar
    and bypass the V1 (run_ocr + parse_score) chain entirely."""
    mock_fetch.return_value = b"fake segment bytes"
    mock_extract.return_value = np.zeros((1080, 1920, 3), dtype=np.uint8)
    mock_ocr_columnar.return_value = {
        "pair1_label": "SANCHEZ / USTERO",
        "pair2_label": "CASTELLO / RUFO",
        "sets_completed": [],
        "current_set_games": "2-0",
        "current_game": "30-0",
        "parse_error": False,
    }
    mock_resolve.return_value = "match-uuid"
    mock_write.return_value = 99
    mock_retain.return_value = None

    columnar_calibration = {
        "scoreboard_bbox": [100, 60, 460, 60],
        "pair_label_column": {"x": 0, "width": 270},
        "set_columns": [],
        "current_set_column": {"x": 298, "width": 25},
        "current_game_column": {"x": 325, "width": 55},
    }

    snapshot_id = run_one_iteration(MagicMock(), _make_config(), columnar_calibration)

    assert snapshot_id == 99
    mock_ocr_columnar.assert_called_once()
    # The V1 path must NOT have been touched
    mock_crop.assert_not_called()
    mock_run_ocr.assert_not_called()
    mock_parse.assert_not_called()
    # The snapshot row carries the columnar parsed_score
    call_args = mock_write.call_args[0]
    snapshot_arg = call_args[1]
    assert snapshot_arg.parsed_score["current_set_games"] == "2-0"
    assert snapshot_arg.parsed_score["current_game"] == "30-0"
    # ocr_columnar doesn't expose a per-cell confidence; happy-path is 1.0
    assert snapshot_arg.ocr_confidence == 1.0
    assert snapshot_arg.raw_text is None
