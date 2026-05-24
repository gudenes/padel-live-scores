"""Tests for config.py — env var loading."""
import pytest

from src.config import Config, load_config


def test_load_config_from_env(monkeypatch):
    """All required env vars present → Config object returned."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "key-123")
    monkeypatch.setenv("OCR_STREAM_LABEL", "premier_p1")
    monkeypatch.setenv("OCR_YOUTUBE_URL", "https://youtube.com/watch?v=abc")
    monkeypatch.setenv("OCR_TOURNAMENT_ID", "11111111-1111-1111-1111-111111111111")
    monkeypatch.setenv("OCR_COURT_LABEL", "Pista Central")
    monkeypatch.setenv("OCR_WORKER_VERSION", "abc1234")

    config = load_config()

    assert config.supabase_url == "https://test.supabase.co"
    assert config.stream_label == "premier_p1"
    assert config.frame_interval_seconds == 3  # default
    assert config.confidence_threshold == 0.7  # default


def test_load_config_missing_required_var_raises(monkeypatch):
    """Missing SUPABASE_URL → ValueError."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "key-123")
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        load_config()


def test_load_config_custom_interval(monkeypatch):
    """OCR_FRAME_INTERVAL_SECONDS overrides default."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "key-123")
    monkeypatch.setenv("OCR_STREAM_LABEL", "x")
    monkeypatch.setenv("OCR_YOUTUBE_URL", "x")
    monkeypatch.setenv("OCR_TOURNAMENT_ID", "x")
    monkeypatch.setenv("OCR_COURT_LABEL", "x")
    monkeypatch.setenv("OCR_WORKER_VERSION", "x")
    monkeypatch.setenv("OCR_FRAME_INTERVAL_SECONDS", "5")

    config = load_config()
    assert config.frame_interval_seconds == 5
