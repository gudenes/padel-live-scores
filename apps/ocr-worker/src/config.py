"""Environment variable loading and validation."""
import os
from dataclasses import dataclass


# Strictly-required vars — the worker can't run without these.
REQUIRED_VARS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "OCR_STREAM_LABEL",
    "OCR_YOUTUBE_URL",
    "OCR_TOURNAMENT_ID",
    "OCR_COURT_LABEL",
]


def _resolve_worker_version() -> str:
    """Resolve the worker version with a Railway-aware fallback chain.

    Order of preference:
      1. ``OCR_WORKER_VERSION`` set explicitly (e.g. a release tag).
      2. ``RAILWAY_GIT_COMMIT_SHA`` — Railway auto-injects this on every
         deploy. Using it here means operators don't need to manually
         template a commit SHA into the Variables tab.
      3. ``"unknown"`` — local dev fallback so ``load_config()`` doesn't
         raise when neither var is set.
    """
    return (
        os.environ.get("OCR_WORKER_VERSION")
        or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or "unknown"
    )


@dataclass
class Config:
    supabase_url: str
    supabase_service_key: str
    stream_label: str
    youtube_url: str
    tournament_id: str
    court_label: str
    worker_version: str
    frame_interval_seconds: int = 3
    confidence_threshold: float = 0.7
    # Probability of retaining a frame to Supabase Storage for a *normal* (≥threshold
    # confidence) snapshot. Low-confidence frames are always retained regardless.
    # Default 0.01 (1 %) gives a steady trickle of frames for baseline inspection
    # without blowing up the bucket. Operators can bump this to 1.0 during smoke
    # tests so every snapshot becomes inspectable from the admin OCR Health drawer.
    frame_retention_rate: float = 0.01


def load_config() -> Config:
    """Load and validate env vars. Raises ValueError on missing required vars."""
    missing = [v for v in REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        raise ValueError(f"Missing required env vars: {', '.join(missing)}")

    return Config(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
        stream_label=os.environ["OCR_STREAM_LABEL"],
        youtube_url=os.environ["OCR_YOUTUBE_URL"],
        tournament_id=os.environ["OCR_TOURNAMENT_ID"],
        court_label=os.environ["OCR_COURT_LABEL"],
        worker_version=_resolve_worker_version(),
        frame_interval_seconds=int(os.environ.get("OCR_FRAME_INTERVAL_SECONDS", "3")),
        confidence_threshold=float(os.environ.get("OCR_CONFIDENCE_THRESHOLD", "0.7")),
        frame_retention_rate=float(os.environ.get("OCR_FRAME_RETENTION_RATE", "0.01")),
    )
