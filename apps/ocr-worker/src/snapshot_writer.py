"""Write a single OCR snapshot to padelgod.ocr_snapshots."""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional


@dataclass
class OcrSnapshotInput:
    frame_at: datetime
    youtube_video_id: str
    stream_label: str
    tournament_id: Optional[str]
    match_id: Optional[str]
    court_label: Optional[str]
    parsed_score: dict
    raw_text: Optional[str]
    ocr_confidence: float
    worker_version: str
    frame_storage_path: Optional[str] = None


def write_snapshot(supabase: Any, snapshot: OcrSnapshotInput) -> int:
    """
    INSERT one row into padelgod.ocr_snapshots. Returns the new row's id.

    Raises if the insert fails or returns no row (network error, schema mismatch).
    """
    payload = {
        "frame_at": snapshot.frame_at.isoformat(),
        "youtube_video_id": snapshot.youtube_video_id,
        "stream_label": snapshot.stream_label,
        "tournament_id": snapshot.tournament_id,
        "match_id": snapshot.match_id,
        "court_label": snapshot.court_label,
        "parsed_score": snapshot.parsed_score,
        "raw_text": snapshot.raw_text,
        "ocr_confidence": snapshot.ocr_confidence,
        "frame_storage_path": snapshot.frame_storage_path,
        "worker_version": snapshot.worker_version,
    }

    response = (
        supabase
        .schema("padelgod")
        .table("ocr_snapshots")
        .insert(payload)
        .execute()
    )

    rows = response.data
    if not rows:
        raise RuntimeError(f"ocr_snapshots insert returned no rows: {response}")
    return rows[0]["id"]
