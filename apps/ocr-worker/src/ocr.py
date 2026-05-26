"""Pytesseract wrapper. Preprocessing + OCR + confidence aggregation.

Two OCR pipelines coexist:

- ``run_ocr(image)``: the V1 single-pass wrapper. Cheap, but on Premier's
  two-tone scoreboard it loses the second digit column (Otsu picks a single
  threshold that suits the navy nameplate but washes out the slightly-lighter
  score-column backgrounds). Kept for backwards compatibility and for
  scoreboards that don't need column-aware handling.
- ``ocr_columnar(frame, calibration)``: the V1.1 column-aware pipeline. Takes
  a calibration JSON describing each cell (pair-label, completed-set columns,
  current-set games, current-game points) and OCRs each cell independently
  with a multi-threshold/multi-PSM sweep + digit whitelist. Built for the
  Premier Padel broadcast scoreboard; see ``calibrations/premier_padel_mid_set_1.json``.
"""
import cv2
import numpy as np
import pytesseract
from typing import Optional


VALID_GAME_POINTS: frozenset[str] = frozenset({"0", "15", "30", "40", "AD"})
SMALL_INT: frozenset[str] = frozenset(str(i) for i in range(10))


def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
    """
    Preprocess a cropped scoreboard image for tesseract (V1 path).

    Steps: convert to grayscale → Otsu threshold → 2x upscale.
    Tesseract performs better on high-contrast, larger images.

    Note: on two-tone scoreboards (different background brightness between the
    pair-label region and the score region), Otsu's single global threshold can
    erase one of the regions. Use ``ocr_columnar`` with a column-aware
    calibration for those.
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


# ──────────────────────────────────────────────────────────────────────────
# V1.1: column-aware per-cell OCR
# ──────────────────────────────────────────────────────────────────────────

# Sweep multiple thresholds because Premier's white scoreboard text sits on a
# two-tone background — the optimal threshold differs between the digits
# column ("30" on a slightly-lighter background) and the names column ("SANCHEZ"
# on dark navy). Empirical sweet spot is 160-220.
_DIGIT_THRESHOLDS: tuple[int, ...] = (160, 180, 190, 200, 210, 220)
# Multiple PSMs because tight single-character cells sometimes need PSM 10
# (single character) where PSM 6/7 fail. Empirically PSM 6 wins most often.
_DIGIT_PSMS: tuple[int, ...] = (6, 7, 10)
_DIGIT_UPSCALE: float = 4.0
_DIGIT_WHITELIST: str = "0123456789AD"


def _ocr_cell_digit(cell: np.ndarray, allowed: frozenset[str]) -> Optional[str]:
    """
    OCR a tight digit cell using a multi-threshold × multi-PSM sweep with a
    digit-only whitelist. Returns the first output that's in ``allowed``,
    falling back to None if no threshold/PSM combination yields a valid score.

    Validation-first (no fallback to "best guess") because shadow-mode V1
    cares more about distinguishing parse-errors from real reads than about
    coverage. A wrong score in a snapshot poisons the diff worker; a missing
    score just shows up as parse_error=true.
    """
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell
    if gray.size == 0:
        return None

    for thresh in _DIGIT_THRESHOLDS:
        _, binary = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        upscaled = cv2.resize(
            binary, None, fx=_DIGIT_UPSCALE, fy=_DIGIT_UPSCALE,
            interpolation=cv2.INTER_CUBIC,
        )
        for psm in _DIGIT_PSMS:
            text = pytesseract.image_to_string(
                upscaled,
                config=f"--psm {psm} -c tessedit_char_whitelist={_DIGIT_WHITELIST}",
            ).strip().replace(" ", "").replace("\n", "")
            if text in allowed:
                return text
    return None


def _ocr_cell_label(cell: np.ndarray) -> Optional[str]:
    """OCR a pair-label cell. Player-name region uses Otsu since the navy
    nameplate has good single-threshold separability."""
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell
    if gray.size == 0:
        return None
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    upscaled = cv2.resize(binary, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    text = pytesseract.image_to_string(upscaled, config="--psm 7").strip()
    return text or None


def ocr_columnar(frame: np.ndarray, calibration: dict) -> dict:
    """
    Run column-aware OCR using a per-cell calibration.

    ``calibration`` shape (all column x/width are RELATIVE to the scoreboard_bbox crop):

    ```
    {
      "scoreboard_bbox": [x, y, w, h],            # full-frame pixel coords
      "row_layout": "two_pair_horizontal",        # only layout supported in V1.1
      "pair_label_column": {"x": int, "width": int},
      "set_columns":        [{"x": int, "width": int}, ...],  # 0+ completed sets
      "current_set_column": {"x": int, "width": int},         # games in current set
      "current_game_column":{"x": int, "width": int},         # points in current game
    }
    ```

    Returns a parsed_score dict (the JSONB payload written to
    ``padelgod.ocr_snapshots.parsed_score``):

    ```
    {
      "pair1_label": "SANCHEZ / USTERO",
      "pair2_label": "CASTELLO / RUFO",
      "sets_completed": ["6-3"],          # one entry per set_columns entry
      "current_set_games": "2-0",         # NEW vs V1 — pair1-pair2 games in current set
      "current_game": "30-0",
      "parse_error": false,               # true if any required cell failed validation
    }
    ```

    Shadow-diff workers should treat ``parse_error=true`` rows as
    no_crionet_baseline and skip the score comparison.
    """
    x, y, w, h = calibration["scoreboard_bbox"]
    crop = frame[y : y + h, x : x + w]
    h_mid = h // 2

    def process_row(row_crop: np.ndarray) -> dict:
        label_col = calibration["pair_label_column"]
        label_cell = row_crop[:, label_col["x"] : label_col["x"] + label_col["width"]]

        set_scores: list[Optional[str]] = []
        for col in calibration.get("set_columns", []):
            cell = row_crop[:, col["x"] : col["x"] + col["width"]]
            set_scores.append(_ocr_cell_digit(cell, SMALL_INT))

        cs_col = calibration["current_set_column"]
        cs_cell = row_crop[:, cs_col["x"] : cs_col["x"] + cs_col["width"]]

        cg_col = calibration["current_game_column"]
        cg_cell = row_crop[:, cg_col["x"] : cg_col["x"] + cg_col["width"]]

        return {
            "label": _ocr_cell_label(label_cell),
            "sets": set_scores,
            "current_set": _ocr_cell_digit(cs_cell, SMALL_INT),
            "current_game": _ocr_cell_digit(cg_cell, VALID_GAME_POINTS),
        }

    pair1 = process_row(crop[:h_mid, :])
    pair2 = process_row(crop[h_mid:, :])

    sets_completed = [
        f"{a}-{b}" for a, b in zip(pair1["sets"], pair2["sets"]) if a and b
    ]

    parse_error = not (
        pair1["current_game"] and pair2["current_game"]
        and pair1["current_set"] and pair2["current_set"]
    )

    return {
        "pair1_label": pair1["label"],
        "pair2_label": pair2["label"],
        "sets_completed": sets_completed,
        "current_set_games": (
            f"{pair1['current_set']}-{pair2['current_set']}"
            if pair1["current_set"] and pair2["current_set"]
            else None
        ),
        "current_game": (
            f"{pair1['current_game']}-{pair2['current_game']}"
            if pair1["current_game"] and pair2["current_game"]
            else None
        ),
        "parse_error": parse_error,
    }


def calibration_is_columnar(calibration: dict) -> bool:
    """True if the calibration JSON describes column metadata for ocr_columnar.

    The orchestrator uses this to decide which OCR path to take. A calibration
    file that only has ``scoreboard_bbox`` will fall through to the V1 path.
    """
    required = ("pair_label_column", "current_set_column", "current_game_column")
    return all(k in calibration for k in required)
