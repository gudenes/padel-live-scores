"""Fetch the latest HLS segment from a YouTube live stream using yt-dlp."""
import subprocess
import tempfile
from pathlib import Path


def fetch_latest_hls_segment(youtube_url: str, timeout_seconds: int = 30) -> bytes:
    """
    Use yt-dlp to download a short HLS segment (~4s) from a live YouTube URL.
    Returns the raw .ts bytes.

    Raises RuntimeError on yt-dlp failure or timeout.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "segment.ts"
        result = subprocess.run(
            [
                "yt-dlp",
                "-f", "best[protocol^=m3u8]",
                "--hls-prefer-native",
                "--no-part",
                "--downloader-args", "ffmpeg:-t 4",
                "-o", str(out_path),
                youtube_url,
            ],
            capture_output=True,
            timeout=timeout_seconds,
        )
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr.decode()}")
        if not out_path.exists():
            raise RuntimeError("yt-dlp produced no output file")
        return out_path.read_bytes()
