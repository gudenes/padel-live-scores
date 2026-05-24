"""Parse raw tesseract output into a structured padel score."""
from typing import Optional, TypedDict


class ParsedScore(TypedDict):
    sets_completed: list[str]
    current_game: Optional[str]
    pair1_label: Optional[str]
    pair2_label: Optional[str]
    parse_error: bool


VALID_GAME_TOKENS = {"0", "15", "30", "40", "AD"}


def _parse_row(row: str) -> Optional[tuple[str, list[str], Optional[str]]]:
    """
    Parse one scoreboard row.
    Returns (label, completed_set_scores, current_game_score) or None on failure.

    Heuristic: the row ends with a sequence of numeric tokens (and possibly 'AD').
    The rightmost token is the current game. Everything before it are either:
    - Completed set scores (if 3+ tokens total)
    - Games in the current set (if 2 tokens total, not counted as completed)
    Everything before the numeric run is the player/pair label.
    """
    tokens = row.strip().split()
    if len(tokens) < 2:
        return None

    # Walk backwards collecting numeric/AD tokens until we hit a non-numeric.
    score_tokens: list[str] = []
    while tokens and (tokens[-1].isdigit() or tokens[-1].upper() == "AD"):
        score_tokens.insert(0, tokens.pop().upper())

    if not score_tokens or not tokens:
        return None

    label = " ".join(tokens).strip()
    if not label:
        return None

    # Last token is always the current game score.
    # Earlier tokens are either completed sets (if 3+ tokens) or current-set games (if 2 tokens).
    if len(score_tokens) <= 2:
        # With 2 or fewer tokens, only the last is current game; earlier ones are games in current set (not completed).
        current_game = score_tokens[-1] if score_tokens[-1] in VALID_GAME_TOKENS else None
        completed = []
    else:
        # With 3+ tokens, all but the last are completed sets.
        current_game = score_tokens[-1] if score_tokens[-1] in VALID_GAME_TOKENS else None
        completed = score_tokens[:-1]

    return label, completed, current_game


def parse_score(raw: str) -> ParsedScore:
    """Parse raw tesseract output into a structured score."""
    error_result: ParsedScore = {
        "sets_completed": [],
        "current_game": None,
        "pair1_label": None,
        "pair2_label": None,
        "parse_error": True,
    }

    if not raw or not raw.strip():
        return error_result

    rows = [r for r in raw.split("\n") if r.strip()]
    if len(rows) < 2:
        return error_result

    row1 = _parse_row(rows[0])
    row2 = _parse_row(rows[1])
    if row1 is None or row2 is None:
        return error_result

    label1, sets1, game1 = row1
    label2, sets2, game2 = row2

    # Pair set scores by index (pair1_set_n vs pair2_set_n) — they must match length.
    if len(sets1) != len(sets2):
        return error_result

    sets_completed = [f"{s1}-{s2}" for s1, s2 in zip(sets1, sets2)]
    current_game = f"{game1}-{game2}" if game1 and game2 else None

    return {
        "sets_completed": sets_completed,
        "current_game": current_game,
        "pair1_label": label1,
        "pair2_label": label2,
        "parse_error": False,
    }
