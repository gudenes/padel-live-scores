"""Environment variable loading and validation."""
import os
from dataclasses import dataclass


REQUIRED_VARS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "OCR_STREAM_LABEL",
    "OCR_YOUTUBE_URL",
    "OCR_TOURNAMENT_ID",
    "OCR_COURT_LABEL",
    "OCR_WORKER_VERSION",
]


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
        worker_version=os.environ["OCR_WORKER_VERSION"],
        frame_interval_seconds=int(os.environ.get("OCR_FRAME_INTERVAL_SECONDS", "3")),
        confidence_threshold=float(os.environ.get("OCR_CONFIDENCE_THRESHOLD", "0.7")),
    )
