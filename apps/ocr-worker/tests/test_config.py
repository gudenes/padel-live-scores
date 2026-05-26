"""Tests for config.py — env var loading + worker-version resolution."""
import pytest

from src.config import Config, load_config


def _set_required(monkeypatch):
    """Set the strictly-required vars (everything except OCR_WORKER_VERSION).

    Always clears OCR_WORKER_VERSION and RAILWAY_GIT_COMMIT_SHA first so each
    test starts from a known baseline.
    """
    monkeypatch.delenv("OCR_WORKER_VERSION", raising=False)
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "key-123")
    monkeypatch.setenv("OCR_STREAM_LABEL", "premier_p1")
    monkeypatch.setenv("OCR_YOUTUBE_URL", "https://youtube.com/watch?v=abc")
    monkeypatch.setenv("OCR_TOURNAMENT_ID", "11111111-1111-1111-1111-111111111111")
    monkeypatch.setenv("OCR_COURT_LABEL", "Pista Central")


def test_load_config_from_env(monkeypatch):
    """All required env vars present + explicit OCR_WORKER_VERSION → Config object returned."""
    _set_required(monkeypatch)
    monkeypatch.setenv("OCR_WORKER_VERSION", "v1.1.0")

    config = load_config()

    assert config.supabase_url == "https://test.supabase.co"
    assert config.stream_label == "premier_p1"
    assert config.worker_version == "v1.1.0"
    assert config.frame_interval_seconds == 3  # default
    assert config.confidence_threshold == 0.7  # default


def test_load_config_missing_required_var_raises(monkeypatch):
    """Missing SUPABASE_URL → ValueError."""
    _set_required(monkeypatch)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        load_config()


def test_load_config_custom_interval(monkeypatch):
    """OCR_FRAME_INTERVAL_SECONDS overrides default."""
    _set_required(monkeypatch)
    monkeypatch.setenv("OCR_FRAME_INTERVAL_SECONDS", "5")

    config = load_config()
    assert config.frame_interval_seconds == 5


def test_worker_version_falls_back_to_railway_sha(monkeypatch):
    """When OCR_WORKER_VERSION is unset, fall back to RAILWAY_GIT_COMMIT_SHA.

    Railway auto-injects this on every deploy, so operators don't have to manually
    paste a commit SHA into the Variables tab.
    """
    _set_required(monkeypatch)
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc1234567890")

    config = load_config()
    assert config.worker_version == "abc1234567890"


def test_worker_version_falls_back_to_unknown(monkeypatch):
    """When both OCR_WORKER_VERSION and RAILWAY_GIT_COMMIT_SHA are unset, use 'unknown'.

    Lets local dev (no Railway, no manual version pin) still load config without raising.
    """
    _set_required(monkeypatch)
    # both already cleared by _set_required

    config = load_config()
    assert config.worker_version == "unknown"


def test_explicit_version_wins_over_railway_sha(monkeypatch):
    """OCR_WORKER_VERSION takes precedence over RAILWAY_GIT_COMMIT_SHA.

    Lets operators pin a release tag (e.g. 'v1.1.0') even on Railway.
    """
    _set_required(monkeypatch)
    monkeypatch.setenv("OCR_WORKER_VERSION", "v1.1.0")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc1234")

    config = load_config()
    assert config.worker_version == "v1.1.0"


def test_frame_retention_rate_defaults_to_one_percent(monkeypatch):
    """Without OCR_FRAME_RETENTION_RATE set, retention rate defaults to 0.01."""
    _set_required(monkeypatch)
    monkeypatch.delenv("OCR_FRAME_RETENTION_RATE", raising=False)

    config = load_config()
    assert config.frame_retention_rate == 0.01


def test_frame_retention_rate_override(monkeypatch):
    """OCR_FRAME_RETENTION_RATE=1.0 retains every frame (smoke-test mode)."""
    _set_required(monkeypatch)
    monkeypatch.setenv("OCR_FRAME_RETENTION_RATE", "1.0")

    config = load_config()
    assert config.frame_retention_rate == 1.0


def test_frame_retention_rate_invalid_raises(monkeypatch):
    """Non-numeric OCR_FRAME_RETENTION_RATE raises ValueError at load time.

    Fail-fast beats silent fall-through: a typo like 'true' shouldn't
    coerce to 0.0 and silently disable retention.
    """
    _set_required(monkeypatch)
    monkeypatch.setenv("OCR_FRAME_RETENTION_RATE", "not-a-float")

    with pytest.raises(ValueError):
        load_config()
