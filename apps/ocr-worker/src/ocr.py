"""Pytesseract wrapper. Preprocessing + OCR + confidence aggregation."""
import cv2
import numpy as np
import pytesseract


def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
    """
    Preprocess a cropped scoreboard image for tesseract.

    Steps: convert to grayscale → adaptive threshold → 2x upscale.
    Tesseract performs better on high-contrast, larger images.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    upscaled = cv2.resize(binary, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    return upscaled


def run_ocr(image: np.ndarray) -> tuple[str, float]:
    """
    Run OCR on a scoreboard crop. Returns (text, mean_confidence).

    mean_confidence is in [0.0, 1.0] — tesseract reports per-character
    confidence as 0-100; we normalize and average over non-empty tokens.
    """
    prepped = preprocess_for_ocr(image)

    data = pytesseract.image_to_data(prepped, output_type=pytesseract.Output.DICT)

    text = "\n".join(_group_into_lines(data))

    confidences = [
        int(c) for c, t in zip(data["conf"], data["text"])
        if t.strip() and int(c) >= 0
    ]
    mean_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

    return text, mean_confidence


def _group_into_lines(data: dict) -> list[str]:
    """
    Group tesseract tokens back into lines using the 'line_num' field.
    """
    lines: dict[int, list[str]] = {}
    for i, text in enumerate(data["text"]):
        if not text.strip():
            continue
        line_num = data["line_num"][i]
        lines.setdefault(line_num, []).append(text)
    return [" ".join(tokens) for _, tokens in sorted(lines.items())]
