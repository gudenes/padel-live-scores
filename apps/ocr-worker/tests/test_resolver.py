"""Tests for resolver.py — court + time → match_id."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from src.resolver import resolve_match_id


def _mock_supabase(matches: list[dict]) -> MagicMock:
    """Build a chained mock that returns `matches` when .execute() is called."""
    mock = MagicMock()
    chained = MagicMock()
    chained.execute.return_value.data = matches
    mock.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.gte.return_value.lte.return_value = chained
    return mock


def test_resolve_returns_single_match_id():
    """Exactly one live match on this court → returns its id."""
    match_id = "11111111-1111-1111-1111-111111111111"
    supabase = _mock_supabase([{"id": match_id}])

    frame_at = datetime(2026, 5, 24, 18, 0, tzinfo=timezone.utc)
    result = resolve_match_id(
        supabase,
        court_label="Pista Central",
        tournament_id="22222222-2222-2222-2222-222222222222",
        frame_at=frame_at,
    )
    assert result == match_id


def test_resolve_returns_none_when_no_matches():
    """No live match on this court → None."""
    supabase = _mock_supabase([])
    result = resolve_match_id(
        supabase,
        court_label="Pista Central",
        tournament_id="22222222-2222-2222-2222-222222222222",
        frame_at=datetime(2026, 5, 24, 18, 0, tzinfo=timezone.utc),
    )
    assert result is None


def test_resolve_returns_none_when_ambiguous():
    """Multiple matches found → None (sweeper will retry)."""
    supabase = _mock_supabase([
        {"id": "11111111-1111-1111-1111-111111111111"},
        {"id": "33333333-3333-3333-3333-333333333333"},
    ])
    result = resolve_match_id(
        supabase,
        court_label="Pista Central",
        tournament_id="22222222-2222-2222-2222-222222222222",
        frame_at=datetime(2026, 5, 24, 18, 0, tzinfo=timezone.utc),
    )
    assert result is None
