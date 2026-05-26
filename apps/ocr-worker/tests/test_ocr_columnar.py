"""Tests for ocr_columnar — V1.1 column-aware OCR.

These tests use a real Premier Padel broadcast frame as a fixture
(Qatar Airways Doha 2026, women's draw, SANCHEZ/USTERO vs CASTELLO/RUFO
at the ~30-minute mark, mid-first-set with score 2-0 games and 30-0 in
the current game). The frame is JPEG-compressed (q=75) — same characteristics
as production MPEG-TS-decoded frames.
"""
import json
from pathlib import Path

import cv2
import pytest

from src.ocr import (
    SMALL_INT,
    VALID_GAME_POINTS,
    _ocr_cell_digit,
    calibration_is_columnar,
    ocr_columnar,
)


CALIBRATIONS_DIR = Path(__file__).parent.parent / "calibrations"


@pytest.fixture
def premier_doha_frame(fixtures_dir: Path):
    """The 30-min mid-set-1 frame from the Doha 2026 broadcast (1920×1080)."""
    img = cv2.imread(str(fixtures_dir / "premier_doha_30min_set1.jpg"))
    assert img is not None, "fixture image missing"
    assert img.shape == (1080, 1920, 3), f"unexpected fixture shape: {img.shape}"
    return img


@pytest.fixture
def premier_mid_set_1_calibration():
    """Load the canonical Premier-Padel mid-first-set calibration JSON."""
    path = CALIBRATIONS_DIR / "premier_padel_mid_set_1.json"
    return json.loads(path.read_text())


def test_calibration_json_is_columnar(premier_mid_set_1_calibration):
    """The shipped calibration declares all the columns ocr_columnar expects."""
    assert calibration_is_columnar(premier_mid_set_1_calibration)


def test_calibration_is_columnar_rejects_v1_only():
    """A V1-style calibration with only scoreboard_bbox must NOT be classified columnar."""
    v1_only = {"scoreboard_bbox": [0, 0, 100, 50]}
    assert calibration_is_columnar(v1_only) is False


def test_ocr_columnar_parses_premier_doha_mid_set_1(
    premier_doha_frame, premier_mid_set_1_calibration
):
    """End-to-end: read SANCHEZ/USTERO 2-0 vs CASTELLO/RUFO 0-0 with current point 30-0.

    The expected match state at the fixture's ~30-min mark:
      - pair1 (SANCHEZ/USTERO): 2 games this set, currently on 30
      - pair2 (CASTELLO/RUFO): 0 games this set, currently on 0
      - no completed sets yet
    """
    result = ocr_columnar(premier_doha_frame, premier_mid_set_1_calibration)

    assert result["parse_error"] is False
    assert result["sets_completed"] == []
    assert result["current_set_games"] == "2-0"
    assert result["current_game"] == "30-0"
    # Player labels — OCR has minor punctuation artifacts but the core text is right.
    # SANCHEZ row sometimes picks up a trailing apostrophe from the server icon.
    assert result["pair1_label"] is not None
    assert "SANCHEZ" in result["pair1_label"]
    assert "USTERO" in result["pair1_label"]
    assert result["pair2_label"] is not None
    assert "CASTELLO" in result["pair2_label"]
    assert "RUFO" in result["pair2_label"]


def test_ocr_cell_digit_rejects_invalid_score():
    """Cells without a valid game-score-shaped output return None (no fallback)."""
    # All-black 30×50 cell — tesseract will read nothing or garbage that fails
    # the SMALL_INT / VALID_GAME_POINTS membership check.
    import numpy as np
    blank = np.zeros((30, 50, 3), dtype=np.uint8)
    assert _ocr_cell_digit(blank, SMALL_INT) is None
    assert _ocr_cell_digit(blank, VALID_GAME_POINTS) is None


def test_small_int_and_valid_game_constants():
    """Lock the constants — these are the allowed-score sets used by the cell OCR."""
    assert SMALL_INT == frozenset({"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"})
    assert VALID_GAME_POINTS == frozenset({"0", "15", "30", "40", "AD"})
