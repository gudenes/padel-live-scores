"""OCR worker orchestrator — one process per stream."""
import re
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import structlog
from supabase import create_client

from src.config import Config, load_config
from src.frame_extract import extract_last_frame
from src.ocr import calibration_is_columnar, ocr_columnar, run_ocr
from src.parse import parse_score
from src.resolver import resolve_match_id
from src.scoreboard_crop import crop_scoreboard, load_calibration
from src.snapshot_writer import OcrSnapshotInput, write_snapshot
from src.storage import maybe_retain_frame
from src.stream_capture import fetch_latest_hls_segment


logger = structlog.get_logger()


def run_one_iteration(supabase, config: Config, calibration: dict) -> int | None:
    """
    Execute one full OCR pipeline iteration. Returns the inserted snapshot id,
    or None if a recoverable error occurred (logged but not raised).

    Note: this is V1 error handling — broad try/except wrapping the whole
    iteration. Spec §6.3 specifies more granular behaviors (exponential backoff
    on HLS errors, stream-down detection, in-memory buffer on insert failures)
    that should be layered in against real failure modes observed in Task 11.
    """
    try:
        segment_bytes = fetch_latest_hls_segment(config.youtube_url)
        frame_at = datetime.now(tz=timezone.utc)
        frame = extract_last_frame(segment_bytes)

        # V1.1: prefer column-aware OCR when the calibration describes columns.
        # Otherwise fall back to the V1 single-pass path so non-Premier
        # scoreboards (or older calibration files) keep working.
        if calibration_is_columnar(calibration):
            parsed = ocr_columnar(frame, calibration)
            # ocr_columnar doesn't return a tesseract confidence — the
            # per-cell sweep accepts cells based on validity, not a single
            # confidence value. Treat overall_confidence as 1.0 when all
            # required cells parsed; 0.0 when parse_error is set. This is a
            # placeholder until V1.2 surfaces per-cell confidences.
            raw_text = None
            confidence = 0.0 if parsed["parse_error"] else 1.0
        else:
            crop = crop_scoreboard(frame, calibration)
            raw_text, confidence = run_ocr(crop)
            parsed = parse_score(raw_text)

        match_id = resolve_match_id(
            supabase, config.court_label, config.tournament_id, frame_at,
        )

        video_id = _extract_youtube_video_id(config.youtube_url)

        snapshot = OcrSnapshotInput(
            frame_at=frame_at,
            youtube_video_id=video_id,
            stream_label=config.stream_label,
            tournament_id=config.tournament_id,
            match_id=match_id,
            court_label=config.court_label,
            parsed_score=parsed,
            raw_text=raw_text,
            ocr_confidence=confidence,
            worker_version=config.worker_version,
        )
        snapshot_id = write_snapshot(supabase, snapshot)

        storage_path = maybe_retain_frame(
            supabase, frame, snapshot_id,
            confidence=confidence,
            threshold=config.confidence_threshold,
        )
        if storage_path:
            supabase.schema("padelgod").table("ocr_snapshots").update(
                {"frame_storage_path": storage_path}
            ).eq("id", snapshot_id).execute()
            logger.info("retained_frame", snapshot_id=snapshot_id, path=storage_path)

        logger.info(
            "snapshot_written",
            snapshot_id=snapshot_id,
            match_id=match_id,
            confidence=confidence,
            parse_error=parsed.get("parse_error", False),
        )
        return snapshot_id

    except Exception as e:
        logger.error("iteration_failed", error=str(e), exc_info=True)
        return None


def _extract_youtube_video_id(url: str) -> str:
    """Pull the video id from a watch URL or live URL."""
    m = re.search(r"(?:v=|youtu\.be/|/live/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else "unknown"


_stop = False


def _handle_signal(signum, _frame):
    global _stop
    logger.info("signal_received", signum=signum)
    _stop = True


def main() -> int:
    config = load_config()
    supabase = create_client(config.supabase_url, config.supabase_service_key)

    cal_path = Path(__file__).parent.parent / "calibrations" / f"{config.stream_label}.json"
    calibration = load_calibration(cal_path)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info("worker_starting", config=config.__dict__)

    while not _stop:
        start = time.time()
        run_one_iteration(supabase, config, calibration)
        elapsed = time.time() - start
        sleep_for = max(0.0, config.frame_interval_seconds - elapsed)
        if sleep_for > 0:
            time.sleep(sleep_for)

    logger.info("worker_stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
