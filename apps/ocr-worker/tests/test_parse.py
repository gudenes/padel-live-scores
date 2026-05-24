"""Tests for parse.py — OCR text → structured score."""
from src.parse import parse_score


def test_parse_score_two_completed_sets_with_current_game():
    """Standard mid-match read: 2 completed sets, current game in progress."""
    raw = "COELLO TAPIA  6  4  30\nGALAN CHINGO  3  2  15"
    result = parse_score(raw)
    assert result == {
        "sets_completed": ["6-3", "4-2"],
        "current_game": "30-15",
        "pair1_label": "COELLO TAPIA",
        "pair2_label": "GALAN CHINGO",
        "parse_error": False,
    }


def test_parse_score_one_set_in_progress():
    """First set, no completed sets yet."""
    raw = "PAQUITO NAVARRO  4  30\nSANYO GUTIERREZ  3  15"
    result = parse_score(raw)
    assert result == {
        "sets_completed": [],
        "current_game": "30-15",
        "pair1_label": "PAQUITO NAVARRO",
        "pair2_label": "SANYO GUTIERREZ",
        "parse_error": False,
    }


def test_parse_score_match_point_with_ad():
    """Game score using 'AD' for advantage."""
    raw = "COELLO TAPIA  6  5  AD\nGALAN CHINGO  4  6  40"
    result = parse_score(raw)
    assert result["current_game"] == "AD-40"


def test_parse_score_unparseable_returns_error():
    """Garbage tesseract output → parse_error=True, no exception raised."""
    raw = "###@@@$$$\n((()))"
    result = parse_score(raw)
    assert result["parse_error"] is True
    assert result["pair1_label"] is None
    assert result["pair2_label"] is None


def test_parse_score_empty_input_returns_error():
    """Empty string → parse_error=True."""
    result = parse_score("")
    assert result["parse_error"] is True
