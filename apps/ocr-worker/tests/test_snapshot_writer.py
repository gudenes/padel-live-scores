"""Tests for snapshot_writer.py — INSERT into padelgod.ocr_snapshots."""
from datetime import datetime, timezone
from unittest.mock import MagicMock

from src.snapshot_writer import write_snapshot, OcrSnapshotInput


def test_write_snapshot_returns_inserted_id():
    """Successful insert returns the new row's id."""
    supabase = MagicMock()
    supabase.schema.return_value.table.return_value.insert.return_value.execute.return_value.data = [
        {"id": 42}
    ]

    input = OcrSnapshotInput(
        frame_at=datetime(2026, 5, 24, 18, 0, tzinfo=timezone.utc),
        youtube_video_id="dQw4w9WgXcQ",
        stream_label="premier_p1_court_central",
        tournament_id="22222222-2222-2222-2222-222222222222",
        match_id="11111111-1111-1111-1111-111111111111",
        court_label="Pista Central",
        parsed_score={
            "sets_completed": ["6-3"],
            "current_game": "30-15",
            "pair1_label": "COELLO TAPIA",
            "pair2_label": "GALAN CHINGO",
            "parse_error": False,
        },
        raw_text="COELLO TAPIA 6 30\nGALAN CHINGO 3 15",
        ocr_confidence=0.87,
        worker_version="abc123",
    )

    result = write_snapshot(supabase, input)

    assert result == 42
    supabase.schema.assert_called_with("padelgod")


def test_write_snapshot_with_null_match_id_works():
    """Snapshot can be written with match_id=None (unresolved)."""
    supabase = MagicMock()
    supabase.schema.return_value.table.return_value.insert.return_value.execute.return_value.data = [
        {"id": 99}
    ]

    input = OcrSnapshotInput(
        frame_at=datetime(2026, 5, 24, 18, 0, tzinfo=timezone.utc),
        youtube_video_id="dQw4w9WgXcQ",
        stream_label="premier_p1_court_central",
        tournament_id="22222222-2222-2222-2222-222222222222",
        match_id=None,
        court_label="Pista Central",
        parsed_score={"parse_error": False, "sets_completed": [], "current_game": None,
                      "pair1_label": "X", "pair2_label": "Y"},
        raw_text="",
        ocr_confidence=0.5,
        worker_version="abc123",
    )

    assert write_snapshot(supabase, input) == 99
