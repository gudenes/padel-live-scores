"""Tests for ocr.py — pytesseract wrapper."""
import cv2

from src.ocr import preprocess_for_ocr, run_ocr


def test_run_ocr_returns_text_and_confidence(fixtures_dir):
    """Running OCR on a clean fixture returns recognizable text and a confidence score."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    text, confidence = run_ocr(img)

    assert isinstance(text, str)
    assert len(text.strip()) > 0
    assert 0.0 <= confidence <= 1.0
    assert confidence > 0.5, f"unexpectedly low OCR confidence: {confidence}"


def test_preprocess_for_ocr_returns_grayscale(fixtures_dir):
    """Preprocessing converts BGR to grayscale (2D array)."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    processed = preprocess_for_ocr(img)
    assert len(processed.shape) == 2


def test_preprocess_for_ocr_upscales(fixtures_dir):
    """Preprocessing upscales the image (tesseract works better at higher res)."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    original_h, original_w = img.shape[:2]
    processed = preprocess_for_ocr(img)
    assert processed.shape[0] >= original_h * 2
    assert processed.shape[1] >= original_w * 2
