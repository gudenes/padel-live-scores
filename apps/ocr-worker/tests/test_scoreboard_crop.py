"""Tests for scoreboard_crop.py — crop fixed region from a video frame."""
import cv2
import pytest

from src.scoreboard_crop import crop_scoreboard, load_calibration


def test_crop_scoreboard_returns_correct_shape(fixtures_dir, sample_calibration):
    """Cropped image has the bbox dimensions from calibration."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    assert frame is not None, "fixture image missing"

    crop = crop_scoreboard(frame, sample_calibration)
    bbox = sample_calibration["scoreboard_bbox"]
    expected_h, expected_w = bbox[3], bbox[2]
    assert crop.shape[0] == expected_h
    assert crop.shape[1] == expected_w


def test_crop_scoreboard_extracts_correct_region(fixtures_dir, sample_calibration):
    """Pixels in the crop match the source frame at the bbox coords."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    crop = crop_scoreboard(frame, sample_calibration)

    x, y, w, h = sample_calibration["scoreboard_bbox"]
    expected = frame[y:y + h, x:x + w]
    assert (crop == expected).all()


def test_crop_scoreboard_raises_on_bbox_out_of_bounds(fixtures_dir):
    """Bbox exceeding frame dimensions raises ValueError."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    bad_calibration = {
        "scoreboard_bbox": [1900, 1000, 500, 500],  # off the right edge
    }
    with pytest.raises(ValueError, match="bbox.*out of frame bounds"):
        crop_scoreboard(frame, bad_calibration)


def test_load_calibration_reads_json(tmp_path):
    """load_calibration reads a JSON file and returns a dict."""
    p = tmp_path / "test_stream.json"
    p.write_text('{"stream_label": "test_stream", "scoreboard_bbox": [0, 0, 10, 10]}')
    cal = load_calibration(p)
    assert cal["stream_label"] == "test_stream"


def test_load_calibration_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_calibration(tmp_path / "missing.json")
