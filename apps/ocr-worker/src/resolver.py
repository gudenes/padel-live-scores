"""Resolve OCR-snapshot context (court + tournament + time) to a match_id."""
from datetime import datetime, timedelta
from typing import Any, Optional


RESOLUTION_WINDOW = timedelta(hours=4)


def resolve_match_id(
    supabase: Any,
    court_label: str,
    tournament_id: str,
    frame_at: datetime,
) -> Optional[str]:
    """
    Find the live match on `court_label` in `tournament_id` whose scheduled_at
    is within ±4h of frame_at. Returns the match UUID, or None if 0 or 2+ match
    (ambiguous; sweeper will retry).
    """
    lower = (frame_at - RESOLUTION_WINDOW).isoformat()
    upper = (frame_at + RESOLUTION_WINDOW).isoformat()

    response = (
        supabase.table("matches")
        .select("id")
        .eq("tournament_id", tournament_id)
        .eq("court", court_label)
        .eq("status", "live")
        .gte("scheduled_at", lower)
        .lte("scheduled_at", upper)
        .execute()
    )

    candidates = response.data or []
    if len(candidates) == 1:
        return candidates[0]["id"]
    return None
