# OCR Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python OCR worker that reads padel scores from YouTube broadcast scoreboards, writes immutable snapshots to a `padelgod` schema table, and runs a TypeScript shadow-diff worker that measures agreement against Crionet ground truth. V1 ships as shadow-only — zero writes to `public.matches`.

**Architecture:** New Python service in `apps/ocr-worker/` deployed to Railway; new tables in `padelgod` schema (mirroring existing `oop_snapshots` / `results_snapshots` pattern); new TypeScript worker `shadow-diff-ocr` in `padelgod/src/workers/` registered in `padelgod/src/scheduler.ts`; new ops tab in the standalone `apps/ops/` admin app (deployed to `admin.padelnachos.com`) at `apps/ops/src/app/(app)/system/ocr-health/`, reading from new API routes at `apps/ops/src/app/api/internal/ocr-health` and `apps/ops/src/app/api/internal/ocr-diff-label`.

**Tech Stack:**
- Python 3.12 + `pytesseract` + `opencv-python-headless` + `yt-dlp` + `httpx` + `supabase-py`
- Tesseract OCR system binary + ffmpeg
- TypeScript / Node 20 (padelgod existing stack)
- Next.js 16 / React 19 (ops dashboard existing stack)
- Supabase Postgres + Storage

**Spec:** [`docs/superpowers/specs/2026-05-24-ocr-worker-design.md`](../specs/2026-05-24-ocr-worker-design.md)

---

## Prerequisites

Before starting Task 1, verify the executing engineer has:

- `supabase` CLI installed and authenticated to the Padel Nachos project
- Python 3.12 + `pip` + ability to `apt-get install tesseract-ocr ffmpeg` (or macOS `brew install tesseract ffmpeg`)
- Railway CLI access to the Padel Nachos Railway project
- Access to the Padel Nachos Supabase project's service key (for local dev)
- A known-good Premier Padel YouTube live stream URL for testing (asked from operator at Task 11 time)

## File Structure Overview

**Created:**

```
supabase/migrations/
  20260524000000_create_ocr_snapshots.sql
  20260524000001_create_ocr_diff_events.sql

apps/ocr-worker/
  pyproject.toml
  Dockerfile
  railway.toml
  README.md
  src/
    __init__.py
    main.py              # orchestrator loop
    config.py            # env var loading
    stream_capture.py    # yt-dlp HLS fetch
    frame_extract.py     # ffmpeg frame extraction
    scoreboard_crop.py   # crop region per calibration JSON
    ocr.py               # pytesseract wrapper
    parse.py             # text → structured score
    resolver.py          # (court + time) → match_id
    snapshot_writer.py   # INSERT into padelgod.ocr_snapshots
    storage.py           # selective frame retention
  calibrations/
    premier_p1_court_central.json  # placeholder; filled in Task 11
  tests/
    __init__.py
    conftest.py
    fixtures/
      sample_scoreboard.png        # cropped scoreboard for OCR tests
      sample_full_frame.png        # full 1920x1080 frame for crop tests
    test_parse.py
    test_scoreboard_crop.py
    test_ocr.py
    test_resolver.py
    test_snapshot_writer.py
    test_storage.py
    test_config.py

padelgod/src/workers/
  shadow-diff-ocr.ts

padelgod/src/workers/__tests__/
  shadow-diff-ocr.test.ts

apps/ops/src/app/(app)/system/ocr-health/
  page.tsx                             # server component, imports tab
  _components/
    OcrHealthTab.tsx                   # client component, fetches + renders

apps/ops/src/app/api/internal/ocr-health/
  route.ts
  __tests__/route.test.ts

apps/ops/src/app/api/internal/ocr-diff-label/
  route.ts
  __tests__/route.test.ts
```

**Modified:**

```
padelgod/src/scheduler.ts             # register shadow-diff-ocr worker
apps/ops/src/components/Sidebar.tsx   # add OCR Health link to System group
```

> **Important context for Tasks 13-15:** The ops dashboard is a **standalone Next.js app** at [`apps/ops/`](../../apps/ops/) deployed to `admin.padelnachos.com` — NOT the `/ops` route in the main Next.js app (that route is being deprecated per [apps/ops/README.md](../../apps/ops/README.md)). The standalone app uses **Auth.js v5** (not the `ops_token` cookie), with `session.user.isOperator` as the authorization gate. Server reads use `serviceClient()` from `apps/ops/src/lib/supabase`. API routes live under `apps/ops/src/app/api/internal/<feature>/route.ts`. Pages live under `apps/ops/src/app/(app)/system/<feature>/page.tsx` + a sibling `_components/<Feature>Tab.tsx`. The sidebar registry is at `apps/ops/src/components/Sidebar.tsx`.

---

## Task 1: Database migrations

**Files:**
- Create: `supabase/migrations/20260524000000_create_ocr_snapshots.sql`
- Create: `supabase/migrations/20260524000001_create_ocr_diff_events.sql`

**Spec reference:** §5.1, §5.2

- [ ] **Step 1: Write `ocr_snapshots` migration**

Create `supabase/migrations/20260524000000_create_ocr_snapshots.sql`:

```sql
-- Create padelgod.ocr_snapshots: append-only log of OCR'd scoreboard reads
-- from broadcast video. See docs/superpowers/specs/2026-05-24-ocr-worker-design.md
-- §5.1 for the full design rationale.
--
-- Schema isolation: lives in padelgod schema (not public). Same pattern as
-- padelgod.oop_snapshots / padelgod.results_snapshots — service-role-only
-- via schema scope, not via RLS.

BEGIN;

CREATE SCHEMA IF NOT EXISTS padelgod;

CREATE TABLE IF NOT EXISTS padelgod.ocr_snapshots (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  frame_at         TIMESTAMPTZ NOT NULL,

  youtube_video_id TEXT NOT NULL,
  stream_label     TEXT NOT NULL,

  tournament_id    UUID REFERENCES public.tournaments(id),
  match_id         UUID REFERENCES public.matches(id),
  court_label      TEXT,

  parsed_score     JSONB NOT NULL,
  raw_text         TEXT,
  ocr_confidence   NUMERIC(4,3) CHECK (ocr_confidence BETWEEN 0 AND 1),

  frame_storage_path TEXT,
  worker_version   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ocr_match_time
  ON padelgod.ocr_snapshots (match_id, frame_at DESC)
  WHERE match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ocr_stream_time
  ON padelgod.ocr_snapshots (stream_label, frame_at DESC);

CREATE INDEX IF NOT EXISTS idx_ocr_unresolved
  ON padelgod.ocr_snapshots (captured_at DESC)
  WHERE match_id IS NULL;

COMMENT ON TABLE padelgod.ocr_snapshots IS
  'OCR-derived scoreboard reads from broadcast video. Append-only, immutable. One row per frame sampled (~1 every 3s while a stream is being captured).';

COMMIT;
```

- [ ] **Step 2: Write `ocr_diff_events` migration**

Create `supabase/migrations/20260524000001_create_ocr_diff_events.sql`:

```sql
-- Create padelgod.ocr_diff_events: agreement / disagreement records between
-- OCR snapshots and Crionet-fed public.sets/games values. Produced by the
-- shadow-diff-ocr worker on a 5-minute cadence.
-- See docs/superpowers/specs/2026-05-24-ocr-worker-design.md §5.2.

BEGIN;

CREATE TABLE IF NOT EXISTS padelgod.ocr_diff_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id        UUID NOT NULL REFERENCES public.matches(id),
  ocr_snapshot_id BIGINT NOT NULL REFERENCES padelgod.ocr_snapshots(id),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  agreement       TEXT NOT NULL CHECK (agreement IN (
                    'match', 'sets_disagree', 'game_disagree',
                    'both_disagree', 'no_crionet_baseline', 'pair_label_mismatch'
                  )),
  ocr_score       JSONB NOT NULL,
  crionet_score   JSONB,
  lag_seconds     INT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_diff_match
  ON padelgod.ocr_diff_events (match_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_diff_disagreements
  ON padelgod.ocr_diff_events (checked_at DESC)
  WHERE agreement != 'match';

COMMENT ON TABLE padelgod.ocr_diff_events IS
  'Per-snapshot agreement classification: ocr_snapshots compared against current public.sets/games. Operator labels (correct/incorrect) written to notes.';

COMMIT;
```

- [ ] **Step 3: Apply migrations locally**

Run:
```bash
supabase db push
```

Expected: both migrations apply cleanly with no errors. If your local schema is drifted from prod, see project memory `project_migration_drift.md` — you may need to apply these directly via the SQL editor in production rather than through the migration tracker.

- [ ] **Step 4: Verify tables exist**

Run:
```bash
supabase db query "SELECT table_name FROM information_schema.tables WHERE table_schema = 'padelgod' AND table_name IN ('ocr_snapshots', 'ocr_diff_events') ORDER BY table_name"
```

Expected output: two rows — `ocr_diff_events`, `ocr_snapshots`.

- [ ] **Step 5: Verify indexes exist**

Run:
```bash
supabase db query "SELECT indexname FROM pg_indexes WHERE schemaname = 'padelgod' AND tablename IN ('ocr_snapshots', 'ocr_diff_events') ORDER BY indexname"
```

Expected output: 5 indexes — `idx_diff_disagreements`, `idx_diff_match`, `idx_ocr_match_time`, `idx_ocr_stream_time`, `idx_ocr_unresolved`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260524000000_create_ocr_snapshots.sql \
        supabase/migrations/20260524000001_create_ocr_diff_events.sql
git commit -m "feat(db): add padelgod.ocr_snapshots and ocr_diff_events tables"
```

---

## Task 2: Python project scaffolding

**Files:**
- Create: `apps/ocr-worker/pyproject.toml`
- Create: `apps/ocr-worker/Dockerfile`
- Create: `apps/ocr-worker/railway.toml`
- Create: `apps/ocr-worker/README.md`
- Create: `apps/ocr-worker/src/__init__.py` (empty)
- Create: `apps/ocr-worker/tests/__init__.py` (empty)
- Create: `apps/ocr-worker/tests/conftest.py`
- Create: `apps/ocr-worker/.gitignore`

**Spec reference:** §9.1

- [ ] **Step 1: Create `pyproject.toml`**

Create `apps/ocr-worker/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "ocr-worker"
version = "0.1.0"
description = "OCR worker for padel broadcast scoreboards"
requires-python = ">=3.12"
dependencies = [
  "pytesseract>=0.3.10",
  "opencv-python-headless>=4.9.0",
  "yt-dlp>=2024.4.0",
  "httpx>=0.27.0",
  "supabase>=2.4.0",
  "pydantic>=2.6.0",
  "python-dotenv>=1.0.0",
  "structlog>=24.1.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0.0",
  "pytest-mock>=3.12.0",
  "pytest-asyncio>=0.23.0",
  "ruff>=0.4.0",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = "test_*.py"
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 2: Create `Dockerfile`**

Create `apps/ocr-worker/Dockerfile`:

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

COPY src/ ./src/
COPY calibrations/ ./calibrations/

# Railway sets PORT but this worker doesn't serve HTTP — just run main
CMD ["python", "-m", "src.main"]
```

- [ ] **Step 3: Create `railway.toml`**

Create `apps/ocr-worker/railway.toml`:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "python -m src.main"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 4: Create `.gitignore`**

Create `apps/ocr-worker/.gitignore`:

```
__pycache__/
*.py[cod]
*.egg-info/
.pytest_cache/
.venv/
venv/
.env
.env.local
```

- [ ] **Step 5: Create empty `__init__.py` files**

Create both `apps/ocr-worker/src/__init__.py` and `apps/ocr-worker/tests/__init__.py` as empty files.

- [ ] **Step 6: Create `tests/conftest.py`**

Create `apps/ocr-worker/tests/conftest.py`:

```python
"""Shared pytest fixtures for ocr-worker tests."""
from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    """Path to the test fixtures directory."""
    return FIXTURES_DIR


@pytest.fixture
def sample_calibration() -> dict:
    """A sample calibration matching `sample_full_frame.png`'s scoreboard."""
    return {
        "stream_label": "test_stream",
        "scoreboard_bbox": [50, 900, 600, 120],
        "row_layout": "two_pair_horizontal",
        "set_columns": [
            {"x": 350, "width": 40},
            {"x": 400, "width": 40},
        ],
        "game_column": {"x": 460, "width": 60},
        "pair_label_column": {"x": 10, "width": 320},
    }
```

- [ ] **Step 7: Create `README.md`**

Create `apps/ocr-worker/README.md`:

```markdown
# OCR Worker

Python service that reads padel scores from the on-screen scoreboard of
YouTube live broadcasts and writes immutable snapshots to
`padelgod.ocr_snapshots`. Shadow-only — does not touch `public.*`.

See [design spec](../../docs/superpowers/specs/2026-05-24-ocr-worker-design.md).

## Local development

```bash
cd apps/ocr-worker
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Environment variables

| Var | Description |
|---|---|
| `SUPABASE_URL` | Padel Nachos Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service-role key (bypasses RLS) |
| `OCR_STREAM_LABEL` | Calibration JSON key (must match a file in `calibrations/`) |
| `OCR_YOUTUBE_URL` | Full YouTube live URL |
| `OCR_TOURNAMENT_ID` | UUID of currently-running tournament |
| `OCR_COURT_LABEL` | Matches `public.matches.court` (e.g. 'Pista Central') |
| `OCR_FRAME_INTERVAL_SECONDS` | Optional, default 3 |
| `OCR_CONFIDENCE_THRESHOLD` | Optional, default 0.7 |
| `OCR_WORKER_VERSION` | Injected at build from `git rev-parse --short HEAD` |
```

- [ ] **Step 8: Install dependencies + verify pytest runs**

Run:
```bash
cd apps/ocr-worker
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Expected: `pytest` runs and exits successfully with "no tests ran" message (we haven't written any yet).

- [ ] **Step 9: Commit**

```bash
git add apps/ocr-worker/
git commit -m "feat(ocr-worker): scaffold Python project structure"
```

---

## Task 3: `parse.py` — OCR text → structured score

**Files:**
- Create: `apps/ocr-worker/src/parse.py`
- Create: `apps/ocr-worker/tests/test_parse.py`

**Spec reference:** §5.1 (parsed_score shape), §6.1 (step 6)

- [ ] **Step 1: Write the failing test**

Create `apps/ocr-worker/tests/test_parse.py`:

```python
"""Tests for parse.py — OCR text → structured score."""
from src.parse import parse_score


def test_parse_score_two_completed_sets_with_current_game():
    """Standard mid-match read: 2 completed sets, current game in progress."""
    raw = "COELLO TAPIA  6  4  30\nGALAN CHINGO  3  2  15"
    result = parse_score(raw)
    assert result == {
        "sets_completed": ["6-3", "4-2"],
        "current_game": "30-15",
        "pair1_label": "COELLO TAPIA",
        "pair2_label": "GALAN CHINGO",
        "parse_error": False,
    }


def test_parse_score_one_set_in_progress():
    """First set, no completed sets yet."""
    raw = "PAQUITO NAVARRO  4  30\nSANYO GUTIERREZ  3  15"
    result = parse_score(raw)
    assert result == {
        "sets_completed": [],
        "current_game": "30-15",
        "pair1_label": "PAQUITO NAVARRO",
        "pair2_label": "SANYO GUTIERREZ",
        "parse_error": False,
    }


def test_parse_score_match_point_with_ad():
    """Game score using 'AD' for advantage."""
    raw = "COELLO TAPIA  6  5  AD\nGALAN CHINGO  4  6  40"
    result = parse_score(raw)
    assert result["current_game"] == "AD-40"


def test_parse_score_unparseable_returns_error():
    """Garbage tesseract output → parse_error=True, no exception raised."""
    raw = "###@@@$$$\n((()))"
    result = parse_score(raw)
    assert result["parse_error"] is True
    assert result["pair1_label"] is None
    assert result["pair2_label"] is None


def test_parse_score_empty_input_returns_error():
    """Empty string → parse_error=True."""
    result = parse_score("")
    assert result["parse_error"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_parse.py -v
```

Expected: FAIL with `ImportError: cannot import name 'parse_score' from 'src.parse'` (or module not found).

- [ ] **Step 3: Implement `parse_score`**

Create `apps/ocr-worker/src/parse.py`:

```python
"""Parse raw tesseract output into a structured padel score."""
import re
from typing import Optional, TypedDict


class ParsedScore(TypedDict):
    sets_completed: list[str]
    current_game: Optional[str]
    pair1_label: Optional[str]
    pair2_label: Optional[str]
    parse_error: bool


VALID_GAME_TOKENS = {"0", "15", "30", "40", "AD"}


def _parse_row(row: str) -> Optional[tuple[str, list[str], Optional[str]]]:
    """
    Parse one scoreboard row.
    Returns (label, completed_set_scores, current_game_score) or None on failure.

    Heuristic: the row ends with a sequence of numeric tokens (and possibly 'AD').
    The trailing token is the current game; earlier tokens are completed sets.
    Everything before the numeric run is the player/pair label.
    """
    tokens = row.strip().split()
    if len(tokens) < 2:
        return None

    # Walk backwards collecting numeric/AD tokens until we hit a non-numeric.
    score_tokens: list[str] = []
    while tokens and (tokens[-1].isdigit() or tokens[-1].upper() == "AD"):
        score_tokens.insert(0, tokens.pop().upper())

    if not score_tokens or not tokens:
        return None

    label = " ".join(tokens).strip()
    if not label:
        return None

    # Last numeric token is the current game; earlier ones are set scores.
    if score_tokens[-1] in VALID_GAME_TOKENS:
        current_game = score_tokens[-1]
        completed = score_tokens[:-1]
    else:
        current_game = None
        completed = score_tokens

    return label, completed, current_game


def parse_score(raw: str) -> ParsedScore:
    """Parse raw tesseract output into a structured score."""
    error_result: ParsedScore = {
        "sets_completed": [],
        "current_game": None,
        "pair1_label": None,
        "pair2_label": None,
        "parse_error": True,
    }

    if not raw or not raw.strip():
        return error_result

    rows = [r for r in raw.split("\n") if r.strip()]
    if len(rows) < 2:
        return error_result

    row1 = _parse_row(rows[0])
    row2 = _parse_row(rows[1])
    if row1 is None or row2 is None:
        return error_result

    label1, sets1, game1 = row1
    label2, sets2, game2 = row2

    # Pair set scores by index (pair1_set_n vs pair2_set_n) — they must match length.
    if len(sets1) != len(sets2):
        return error_result

    sets_completed = [f"{s1}-{s2}" for s1, s2 in zip(sets1, sets2)]
    current_game = f"{game1}-{game2}" if game1 and game2 else None

    return {
        "sets_completed": sets_completed,
        "current_game": current_game,
        "pair1_label": label1,
        "pair2_label": label2,
        "parse_error": False,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_parse.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ocr-worker/src/parse.py apps/ocr-worker/tests/test_parse.py
git commit -m "feat(ocr-worker): parse tesseract text into structured score"
```

---

## Task 4: `scoreboard_crop.py` — crop fixed region per calibration

**Files:**
- Create: `apps/ocr-worker/src/scoreboard_crop.py`
- Create: `apps/ocr-worker/tests/test_scoreboard_crop.py`
- Create: `apps/ocr-worker/tests/fixtures/sample_full_frame.png` (1920×1080 with synthetic scoreboard — generated by test setup)

**Spec reference:** §6.2

- [ ] **Step 1: Generate a synthetic fixture frame**

Create `apps/ocr-worker/tests/fixtures/generate_fixtures.py` (one-time generator, not committed as a test):

```python
"""Generate synthetic test fixtures. Run once; output PNGs are committed."""
import cv2
import numpy as np


def generate_full_frame():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    # Background: dark green padel court
    frame[:] = (30, 80, 30)
    # White scoreboard rectangle at bbox [50, 900, 600, 120]
    cv2.rectangle(frame, (50, 900), (650, 1020), (245, 245, 245), -1)
    cv2.putText(frame, "COELLO TAPIA  6  4  30", (60, 950),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(frame, "GALAN CHINGO  3  2  15", (60, 1000),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.imwrite("sample_full_frame.png", frame)


if __name__ == "__main__":
    generate_full_frame()
```

Run from `apps/ocr-worker/tests/fixtures/`:
```bash
cd apps/ocr-worker/tests/fixtures && python generate_fixtures.py
```

This produces `sample_full_frame.png`. Commit the PNG; the generator script can stay alongside for regenerating later.

- [ ] **Step 2: Write the failing test**

Create `apps/ocr-worker/tests/test_scoreboard_crop.py`:

```python
"""Tests for scoreboard_crop.py — crop fixed region from a video frame."""
import cv2
import pytest

from src.scoreboard_crop import crop_scoreboard, load_calibration


def test_crop_scoreboard_returns_correct_shape(fixtures_dir, sample_calibration):
    """Cropped image has the bbox dimensions from calibration."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    assert frame is not None, "fixture image missing"

    crop = crop_scoreboard(frame, sample_calibration)
    bbox = sample_calibration["scoreboard_bbox"]
    expected_h, expected_w = bbox[3], bbox[2]
    assert crop.shape[0] == expected_h
    assert crop.shape[1] == expected_w


def test_crop_scoreboard_extracts_correct_region(fixtures_dir, sample_calibration):
    """Pixels in the crop match the source frame at the bbox coords."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    crop = crop_scoreboard(frame, sample_calibration)

    x, y, w, h = sample_calibration["scoreboard_bbox"]
    expected = frame[y:y + h, x:x + w]
    assert (crop == expected).all()


def test_crop_scoreboard_raises_on_bbox_out_of_bounds(fixtures_dir):
    """Bbox exceeding frame dimensions raises ValueError."""
    frame = cv2.imread(str(fixtures_dir / "sample_full_frame.png"))
    bad_calibration = {
        "scoreboard_bbox": [1900, 1000, 500, 500],  # off the right edge
    }
    with pytest.raises(ValueError, match="bbox.*out of frame bounds"):
        crop_scoreboard(frame, bad_calibration)


def test_load_calibration_reads_json(tmp_path):
    """load_calibration reads a JSON file and returns a dict."""
    p = tmp_path / "test_stream.json"
    p.write_text('{"stream_label": "test_stream", "scoreboard_bbox": [0, 0, 10, 10]}')
    cal = load_calibration(p)
    assert cal["stream_label"] == "test_stream"


def test_load_calibration_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_calibration(tmp_path / "missing.json")
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_scoreboard_crop.py -v
```

Expected: FAIL with import error on `src.scoreboard_crop`.

- [ ] **Step 4: Implement `scoreboard_crop.py`**

Create `apps/ocr-worker/src/scoreboard_crop.py`:

```python
"""Crop the scoreboard region from a video frame using per-stream calibration."""
import json
from pathlib import Path
from typing import Any

import numpy as np


def load_calibration(path: Path | str) -> dict[str, Any]:
    """Load a calibration JSON file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Calibration file not found: {p}")
    return json.loads(p.read_text())


def crop_scoreboard(frame: np.ndarray, calibration: dict[str, Any]) -> np.ndarray:
    """
    Crop the scoreboard region from a frame using calibration bbox.

    Args:
        frame: full video frame as np.ndarray of shape (H, W, 3) BGR.
        calibration: dict with 'scoreboard_bbox' = [x, y, width, height].

    Returns:
        Cropped region as a new np.ndarray view.

    Raises:
        ValueError: if bbox falls outside the frame.
        KeyError: if calibration is missing 'scoreboard_bbox'.
    """
    bbox = calibration["scoreboard_bbox"]
    x, y, w, h = bbox
    frame_h, frame_w = frame.shape[:2]

    if x < 0 or y < 0 or x + w > frame_w or y + h > frame_h:
        raise ValueError(
            f"bbox {bbox} out of frame bounds {frame_w}x{frame_h}"
        )

    return frame[y:y + h, x:x + w]
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_scoreboard_crop.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ocr-worker/src/scoreboard_crop.py \
        apps/ocr-worker/tests/test_scoreboard_crop.py \
        apps/ocr-worker/tests/fixtures/sample_full_frame.png \
        apps/ocr-worker/tests/fixtures/generate_fixtures.py
git commit -m "feat(ocr-worker): crop scoreboard region from frame using calibration"
```

---

## Task 5: `ocr.py` — pytesseract wrapper

**Files:**
- Create: `apps/ocr-worker/src/ocr.py`
- Create: `apps/ocr-worker/tests/test_ocr.py`
- Create: `apps/ocr-worker/tests/fixtures/sample_scoreboard.png` (cropped, OCR-readable)

**Spec reference:** §6.1 (steps 4-5)

- [ ] **Step 1: Generate scoreboard fixture**

Append to `apps/ocr-worker/tests/fixtures/generate_fixtures.py`:

```python
def generate_scoreboard():
    """High-contrast scoreboard crop suitable for OCR."""
    img = np.full((120, 600, 3), 245, dtype=np.uint8)  # near-white background
    cv2.putText(img, "COELLO TAPIA  6  4  30", (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2)
    cv2.putText(img, "GALAN CHINGO  3  2  15", (10, 100),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2)
    cv2.imwrite("sample_scoreboard.png", img)


if __name__ == "__main__":
    generate_full_frame()
    generate_scoreboard()
```

Run:
```bash
cd apps/ocr-worker/tests/fixtures && python generate_fixtures.py
```

- [ ] **Step 2: Write the failing test**

Create `apps/ocr-worker/tests/test_ocr.py`:

```python
"""Tests for ocr.py — pytesseract wrapper."""
import cv2

from src.ocr import preprocess_for_ocr, run_ocr


def test_run_ocr_returns_text_and_confidence(fixtures_dir):
    """Running OCR on a clean fixture returns recognizable text and a confidence score."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    text, confidence = run_ocr(img)

    # We don't assert exact text — tesseract output varies by version.
    # We assert that it found *something* reasonable.
    assert isinstance(text, str)
    assert len(text.strip()) > 0
    assert 0.0 <= confidence <= 1.0
    # Real-world expectation: a clean fixture should give >0.5 mean confidence
    assert confidence > 0.5, f"unexpectedly low OCR confidence: {confidence}"


def test_preprocess_for_ocr_returns_grayscale(fixtures_dir):
    """Preprocessing converts BGR to grayscale (2D array)."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    processed = preprocess_for_ocr(img)
    assert len(processed.shape) == 2  # grayscale = 2D


def test_preprocess_for_ocr_upscales(fixtures_dir):
    """Preprocessing upscales the image (tesseract works better at higher res)."""
    img = cv2.imread(str(fixtures_dir / "sample_scoreboard.png"))
    original_h, original_w = img.shape[:2]
    processed = preprocess_for_ocr(img)
    assert processed.shape[0] >= original_h * 2
    assert processed.shape[1] >= original_w * 2
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_ocr.py -v
```

Expected: FAIL with import error on `src.ocr`.

- [ ] **Step 4: Implement `ocr.py`**

Create `apps/ocr-worker/src/ocr.py`:

```python
"""Pytesseract wrapper. Preprocessing + OCR + confidence aggregation."""
import cv2
import numpy as np
import pytesseract


def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
    """
    Preprocess a cropped scoreboard image for tesseract.

    Steps: convert to grayscale → adaptive threshold → 2x upscale.
    Tesseract performs better on high-contrast, larger images.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    # Otsu binarization picks the threshold automatically
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 2x upscale with cubic interpolation
    upscaled = cv2.resize(binary, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    return upscaled


def run_ocr(image: np.ndarray) -> tuple[str, float]:
    """
    Run OCR on a scoreboard crop. Returns (text, mean_confidence).

    mean_confidence is in [0.0, 1.0] — tesseract reports per-character
    confidence as 0-100; we normalize and average over non-empty tokens.
    """
    prepped = preprocess_for_ocr(image)

    # image_to_data returns a dict with per-token text, confidence, position
    data = pytesseract.image_to_data(prepped, output_type=pytesseract.Output.DICT)

    texts = [t for t in data["text"] if t.strip()]
    text = "\n".join(_group_into_lines(data))

    confidences = [
        int(c) for c, t in zip(data["conf"], data["text"])
        if t.strip() and int(c) >= 0
    ]
    mean_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

    return text, mean_confidence


def _group_into_lines(data: dict) -> list[str]:
    """
    Group tesseract tokens back into lines using the 'line_num' field.
    Tesseract's `image_to_data` returns tokens with structural metadata —
    we use line_num to reconstruct two rows of a scoreboard.
    """
    lines: dict[int, list[str]] = {}
    for i, text in enumerate(data["text"]):
        if not text.strip():
            continue
        line_num = data["line_num"][i]
        lines.setdefault(line_num, []).append(text)
    return [" ".join(tokens) for _, tokens in sorted(lines.items())]
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_ocr.py -v
```

Expected: all 3 tests PASS. If confidence assertion fails because of fixture variability, regenerate the fixture or lower the threshold to 0.3.

- [ ] **Step 6: Commit**

```bash
git add apps/ocr-worker/src/ocr.py \
        apps/ocr-worker/tests/test_ocr.py \
        apps/ocr-worker/tests/fixtures/sample_scoreboard.png \
        apps/ocr-worker/tests/fixtures/generate_fixtures.py
git commit -m "feat(ocr-worker): pytesseract wrapper with preprocessing"
```

---

## Task 6: `resolver.py` — court + time → match_id

**Files:**
- Create: `apps/ocr-worker/src/resolver.py`
- Create: `apps/ocr-worker/tests/test_resolver.py`

**Spec reference:** §6.4

- [ ] **Step 1: Write the failing test**

Create `apps/ocr-worker/tests/test_resolver.py`:

```python
"""Tests for resolver.py — court + time → match_id."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from src.resolver import resolve_match_id


def _mock_supabase(matches: list[dict]) -> MagicMock:
    """Build a chained mock that returns `matches` when .execute() is called."""
    mock = MagicMock()
    chain = mock.table.return_value
    for method in ["select", "eq", "gte", "lte"]:
        chain = getattr(chain, method).return_value
        # Each method returns the same chain object
    chain.execute.return_value.data = matches
    # We need .table().select().eq().eq().eq().gte().lte().execute() —
    # use side_effect to return the same chain on every call:
    mock.reset_mock()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_resolver.py -v
```

Expected: FAIL with import error on `src.resolver`.

- [ ] **Step 3: Implement `resolver.py`**

Create `apps/ocr-worker/src/resolver.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_resolver.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ocr-worker/src/resolver.py apps/ocr-worker/tests/test_resolver.py
git commit -m "feat(ocr-worker): match_id resolution from court + tournament + time"
```

---

## Task 7: `snapshot_writer.py` — INSERT into ocr_snapshots

**Files:**
- Create: `apps/ocr-worker/src/snapshot_writer.py`
- Create: `apps/ocr-worker/tests/test_snapshot_writer.py`

**Spec reference:** §5.1, §6.1 (step 8)

- [ ] **Step 1: Write the failing test**

Create `apps/ocr-worker/tests/test_snapshot_writer.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_snapshot_writer.py -v
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement `snapshot_writer.py`**

Create `apps/ocr-worker/src/snapshot_writer.py`:

```python
"""Write a single OCR snapshot to padelgod.ocr_snapshots."""
from dataclasses import asdict, dataclass
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_snapshot_writer.py -v
```

Expected: all 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ocr-worker/src/snapshot_writer.py apps/ocr-worker/tests/test_snapshot_writer.py
git commit -m "feat(ocr-worker): write snapshots to padelgod.ocr_snapshots"
```

---

## Task 8: `storage.py` — selective frame retention

**Files:**
- Create: `apps/ocr-worker/src/storage.py`
- Create: `apps/ocr-worker/tests/test_storage.py`

**Spec reference:** §5.1 ("Frame storage is selective"), §6.1 (step 9)

- [ ] **Step 1: Write the failing test**

Create `apps/ocr-worker/tests/test_storage.py`:

```python
"""Tests for storage.py — selective frame retention to Supabase Storage."""
from unittest.mock import MagicMock

import numpy as np

from src.storage import maybe_retain_frame, FRAMES_BUCKET


def test_retain_when_below_confidence_threshold():
    """Low-confidence frames are always retained."""
    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.5, threshold=0.7,
        random_sample_rate=0.0,  # disable random sampling for this test
    )

    assert path is not None
    assert "42" in path
    supabase.storage.from_.assert_called_with(FRAMES_BUCKET)


def test_skip_when_above_threshold_and_no_sample():
    """High-confidence + no random hit = no retention."""
    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.9, threshold=0.7,
        random_sample_rate=0.0,
    )

    assert path is None
    supabase.storage.from_.assert_not_called()


def test_random_sample_retains_some_frames(monkeypatch):
    """1% sample rate retains a frame when random() returns 0.005."""
    import src.storage as storage_mod
    monkeypatch.setattr(storage_mod, "_random", lambda: 0.005)

    supabase = MagicMock()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    path = maybe_retain_frame(
        supabase, frame, snapshot_id=42,
        confidence=0.9, threshold=0.7,
        random_sample_rate=0.01,
    )
    assert path is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_storage.py -v
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement `storage.py`**

Create `apps/ocr-worker/src/storage.py`:

```python
"""Selective frame retention to Supabase Storage 'ocr-frames' bucket."""
import io
from random import random as _random
from typing import Any, Optional

import cv2
import numpy as np


FRAMES_BUCKET = "ocr-frames"
DEFAULT_SAMPLE_RATE = 0.01


def maybe_retain_frame(
    supabase: Any,
    frame: np.ndarray,
    snapshot_id: int,
    confidence: float,
    threshold: float = 0.7,
    random_sample_rate: float = DEFAULT_SAMPLE_RATE,
) -> Optional[str]:
    """
    Decide whether to upload `frame` to Supabase Storage, and do so if yes.

    Retains if:
      - confidence < threshold (low-confidence debug case), OR
      - random sample hits (random() < random_sample_rate)

    Returns the storage path on retention, or None if skipped.
    Uploads as PNG.
    """
    should_retain = (confidence < threshold) or (_random() < random_sample_rate)
    if not should_retain:
        return None

    success, png_bytes = cv2.imencode(".png", frame)
    if not success:
        raise RuntimeError("Failed to encode frame as PNG")

    path = f"snapshots/{snapshot_id}.png"
    supabase.storage.from_(FRAMES_BUCKET).upload(
        path=path,
        file=png_bytes.tobytes(),
        file_options={"content-type": "image/png"},
    )
    return path
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_storage.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Create the storage bucket**

Run via Supabase CLI or the dashboard SQL editor:
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('ocr-frames', 'ocr-frames', false)
ON CONFLICT (id) DO NOTHING;
```

Verify in the Supabase Storage dashboard that the `ocr-frames` bucket exists and is **private** (not public).

- [ ] **Step 6: Commit**

```bash
git add apps/ocr-worker/src/storage.py apps/ocr-worker/tests/test_storage.py
git commit -m "feat(ocr-worker): selective frame retention to Supabase Storage"
```

---

## Task 9: `stream_capture.py` + `frame_extract.py` — yt-dlp + ffmpeg

**Files:**
- Create: `apps/ocr-worker/src/stream_capture.py`
- Create: `apps/ocr-worker/src/frame_extract.py`
- Create: `apps/ocr-worker/tests/test_stream_capture.py`
- Create: `apps/ocr-worker/tests/test_frame_extract.py`
- Create: `apps/ocr-worker/tests/fixtures/sample_segment.ts` (recorded HLS segment, ~2-6 seconds, downloaded once from a real Premier stream)

**Spec reference:** §6.1 (steps 1-2)

These two modules wrap external processes (yt-dlp, ffmpeg). Unit testing them with mocks isn't valuable — they're thin wrappers. The test strategy is one integration test per module using a recorded fixture.

- [ ] **Step 1: Record a fixture HLS segment**

While a Premier Padel stream is live:
```bash
cd apps/ocr-worker/tests/fixtures
yt-dlp -f "best[protocol^=m3u8]" \
       --hls-prefer-native \
       --no-part \
       --downloader-args "ffmpeg:-t 4" \
       -o sample_segment.ts \
       "<live URL>"
```

Verify with `ls -lh sample_segment.ts` that the file is non-empty (~100KB-1MB).

If no Premier stream is live, fall back to any short HLS .ts segment from a public source (broadcast quality not required for the test).

- [ ] **Step 2: Write the failing test for `frame_extract`**

Create `apps/ocr-worker/tests/test_frame_extract.py`:

```python
"""Integration test for frame_extract.py — uses recorded HLS segment."""
import numpy as np

from src.frame_extract import extract_last_frame


def test_extract_last_frame_returns_image(fixtures_dir):
    """Extract the last frame from a recorded .ts segment."""
    segment_path = fixtures_dir / "sample_segment.ts"
    segment_bytes = segment_path.read_bytes()

    frame = extract_last_frame(segment_bytes)

    assert isinstance(frame, np.ndarray)
    assert len(frame.shape) == 3  # H, W, 3 channels
    assert frame.shape[2] == 3
    assert frame.shape[0] > 100  # reasonable height
    assert frame.shape[1] > 100  # reasonable width
```

- [ ] **Step 3: Implement `frame_extract.py`**

Create `apps/ocr-worker/src/frame_extract.py`:

```python
"""Extract the last frame from an HLS .ts segment using ffmpeg."""
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def extract_last_frame(segment_bytes: bytes) -> np.ndarray:
    """
    Decode the last frame of a .ts HLS segment and return it as a BGR ndarray.

    Uses ffmpeg via subprocess to seek to ~50ms before the end of the segment
    and dump that frame as PNG.
    """
    with tempfile.TemporaryDirectory() as tmp:
        seg_path = Path(tmp) / "segment.ts"
        png_path = Path(tmp) / "last.png"
        seg_path.write_bytes(segment_bytes)

        # -sseof -0.05: seek to 50ms before end of file
        # -vframes 1: capture exactly one frame
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-sseof", "-0.05",
                "-i", str(seg_path),
                "-vframes", "1",
                "-loglevel", "error",
                str(png_path),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")

        if not png_path.exists():
            raise RuntimeError("ffmpeg produced no output frame")

        frame = cv2.imread(str(png_path))
        if frame is None:
            raise RuntimeError("Failed to read extracted frame")
        return frame
```

- [ ] **Step 4: Run frame_extract test**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_frame_extract.py -v
```

Expected: PASS (assuming ffmpeg is installed locally).

- [ ] **Step 5: Write the failing test for `stream_capture`**

Create `apps/ocr-worker/tests/test_stream_capture.py`:

```python
"""Tests for stream_capture.py — yt-dlp HLS playlist fetch.

Network-dependent test: marked as `slow` and skipped by default.
Run explicitly with `pytest -m slow tests/test_stream_capture.py`.
"""
import pytest

from src.stream_capture import fetch_latest_hls_segment


@pytest.mark.slow
def test_fetch_latest_segment_against_known_stream():
    """Smoke test: pull a segment from any public live stream.

    This test requires a live YouTube stream URL passed via env var.
    Skip if not set.
    """
    import os
    url = os.environ.get("OCR_TEST_LIVE_URL")
    if not url:
        pytest.skip("Set OCR_TEST_LIVE_URL to run this integration test")

    segment_bytes = fetch_latest_hls_segment(url)
    assert isinstance(segment_bytes, bytes)
    assert len(segment_bytes) > 10_000  # at least 10KB
```

Append to `pyproject.toml` under `[tool.pytest.ini_options]`:
```toml
markers = ["slow: integration tests requiring network/external processes"]
```

- [ ] **Step 6: Implement `stream_capture.py`**

Create `apps/ocr-worker/src/stream_capture.py`:

```python
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
```

- [ ] **Step 7: Run unit tests (excluding slow)**

Run:
```bash
cd apps/ocr-worker && pytest -v --ignore=tests/test_stream_capture.py
```

Expected: all non-slow tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/ocr-worker/src/frame_extract.py \
        apps/ocr-worker/src/stream_capture.py \
        apps/ocr-worker/tests/test_frame_extract.py \
        apps/ocr-worker/tests/test_stream_capture.py \
        apps/ocr-worker/tests/fixtures/sample_segment.ts \
        apps/ocr-worker/pyproject.toml
git commit -m "feat(ocr-worker): HLS capture (yt-dlp) and frame extraction (ffmpeg)"
```

---

## Task 10: `config.py` + `main.py` — orchestrator loop

**Files:**
- Create: `apps/ocr-worker/src/config.py`
- Create: `apps/ocr-worker/src/main.py`
- Create: `apps/ocr-worker/tests/test_config.py`
- Create: `apps/ocr-worker/tests/test_main.py`

**Spec reference:** §6.1, §9.2

- [ ] **Step 1: Write the failing test for `config`**

Create `apps/ocr-worker/tests/test_config.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_config.py -v
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement `config.py`**

Create `apps/ocr-worker/src/config.py`:

```python
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
```

- [ ] **Step 4: Run config test**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_config.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Write the failing test for `main`**

Create `apps/ocr-worker/tests/test_main.py`:

```python
"""Smoke test for main.py — one iteration with mocked dependencies."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np

from src.config import Config
from src.main import run_one_iteration


def _make_config() -> Config:
    return Config(
        supabase_url="https://t.supabase.co",
        supabase_service_key="k",
        stream_label="test",
        youtube_url="https://yt/abc",
        tournament_id="11111111-1111-1111-1111-111111111111",
        court_label="Pista Central",
        worker_version="abc",
    )


@patch("src.main.fetch_latest_hls_segment")
@patch("src.main.extract_last_frame")
@patch("src.main.crop_scoreboard")
@patch("src.main.run_ocr")
@patch("src.main.parse_score")
@patch("src.main.resolve_match_id")
@patch("src.main.write_snapshot")
@patch("src.main.maybe_retain_frame")
def test_run_one_iteration_happy_path(
    mock_retain, mock_write, mock_resolve, mock_parse,
    mock_ocr, mock_crop, mock_extract, mock_fetch,
):
    """Pipeline runs end-to-end, writes one snapshot."""
    mock_fetch.return_value = b"fake segment bytes"
    mock_extract.return_value = np.zeros((1080, 1920, 3), dtype=np.uint8)
    mock_crop.return_value = np.zeros((120, 600, 3), dtype=np.uint8)
    mock_ocr.return_value = ("COELLO 6 30\nGALAN 3 15", 0.85)
    mock_parse.return_value = {
        "sets_completed": ["6-3"], "current_game": "30-15",
        "pair1_label": "COELLO", "pair2_label": "GALAN", "parse_error": False,
    }
    mock_resolve.return_value = "match-uuid"
    mock_write.return_value = 42
    mock_retain.return_value = None

    config = _make_config()
    supabase = MagicMock()
    calibration = {"scoreboard_bbox": [50, 900, 600, 120]}

    snapshot_id = run_one_iteration(supabase, config, calibration)

    assert snapshot_id == 42
    mock_fetch.assert_called_once()
    mock_write.assert_called_once()
```

- [ ] **Step 6: Run test to verify it fails**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_main.py -v
```

Expected: FAIL with import error.

- [ ] **Step 7: Implement `main.py`**

Create `apps/ocr-worker/src/main.py`:

```python
"""OCR worker orchestrator — one process per stream."""
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import structlog
from supabase import create_client

from src.config import Config, load_config
from src.frame_extract import extract_last_frame
from src.ocr import run_ocr
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
    """
    try:
        segment_bytes = fetch_latest_hls_segment(config.youtube_url)
        frame_at = datetime.now(tz=timezone.utc)
        frame = extract_last_frame(segment_bytes)
        crop = crop_scoreboard(frame, calibration)
        raw_text, confidence = run_ocr(crop)
        parsed = parse_score(raw_text)
        match_id = resolve_match_id(
            supabase, config.court_label, config.tournament_id, frame_at,
        )

        # Extract video id from URL for the snapshot
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

        # Optional frame retention
        storage_path = maybe_retain_frame(
            supabase, frame, snapshot_id,
            confidence=confidence,
            threshold=config.confidence_threshold,
        )
        if storage_path:
            logger.info("retained_frame", snapshot_id=snapshot_id, path=storage_path)

        logger.info(
            "snapshot_written",
            snapshot_id=snapshot_id,
            match_id=match_id,
            confidence=confidence,
            parse_error=parsed["parse_error"],
        )
        return snapshot_id

    except Exception as e:
        logger.error("iteration_failed", error=str(e), exc_info=True)
        return None


def _extract_youtube_video_id(url: str) -> str:
    """Pull the video id from a watch URL or live URL."""
    import re
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
```

- [ ] **Step 8: Run main test**

Run:
```bash
cd apps/ocr-worker && pytest tests/test_main.py -v
```

Expected: PASS.

> **Note on error handling:** the `main.py` above wraps each iteration in a broad try/except that logs and continues. The spec §6.3 specifies more granular behaviors: exponential backoff on HLS network errors (1s, 2s, 4s, 8s, 16s, max 5 retries), stream-down detection with 30-minute clean exit, and an in-memory buffer for failed inserts. Add these in the integration pass once the happy-path smoke test in Task 11 passes — they're better added against real failure modes observed from a running stream than guessed at upfront.

- [ ] **Step 9: Run full test suite**

Run:
```bash
cd apps/ocr-worker && pytest -v
```

Expected: all tests PASS except the network-marked slow test.

- [ ] **Step 10: Commit**

```bash
git add apps/ocr-worker/src/config.py apps/ocr-worker/src/main.py \
        apps/ocr-worker/tests/test_config.py apps/ocr-worker/tests/test_main.py
git commit -m "feat(ocr-worker): orchestrator loop and config loading"
```

---

## Task 11: First calibration JSON + Railway deployment

**Files:**
- Create: `apps/ocr-worker/calibrations/premier_p1_court_central.json`
- Modify: `apps/ocr-worker/README.md` (add deployment section)

**Spec reference:** §6.2, §9.1, §9.2

This task involves operator work: capturing a Premier scoreboard screenshot, measuring the bbox, deploying to Railway.

- [ ] **Step 1: Capture a sample frame from a live Premier stream**

While a Premier match is live:
```bash
cd apps/ocr-worker
source .venv/bin/activate
python -c "
from src.stream_capture import fetch_latest_hls_segment
from src.frame_extract import extract_last_frame
import cv2
seg = fetch_latest_hls_segment('<LIVE_PREMIER_URL>')
frame = extract_last_frame(seg)
cv2.imwrite('/tmp/premier_sample.png', frame)
print('wrote /tmp/premier_sample.png shape:', frame.shape)
"
```

- [ ] **Step 2: Measure the scoreboard bbox**

Open `/tmp/premier_sample.png` in any image editor (Preview, GIMP, etc.). Identify the scoreboard graphic. Note the **top-left corner** pixel coords (x, y) and **width, height** of the scoreboard bounding box.

Suggested approach: hover over corners in Preview's tools menu showing pixel coordinates, or use a Python one-liner:
```bash
python -c "
import cv2
img = cv2.imread('/tmp/premier_sample.png')
roi = cv2.selectROI('select scoreboard', img, False)
cv2.destroyAllWindows()
print('bbox [x, y, w, h]:', list(roi))
"
```

- [ ] **Step 3: Write the calibration JSON**

Create `apps/ocr-worker/calibrations/premier_p1_court_central.json` (replace coordinate placeholders with measured values):

```json
{
  "stream_label": "premier_p1_court_central",
  "scoreboard_bbox": [REPLACE_X, REPLACE_Y, REPLACE_W, REPLACE_H],
  "row_layout": "two_pair_horizontal",
  "notes": "Calibrated against <tournament name> on <date>. Premier Padel standard scoreboard graphic. Update if Premier rebrands."
}
```

For V1, only `scoreboard_bbox` is read by the worker. The other fields are documentation for future column-level extraction (V2 server-identity work).

- [ ] **Step 4: Verify calibration end-to-end locally**

```bash
cd apps/ocr-worker
source .venv/bin/activate
export SUPABASE_URL="<...>"
export SUPABASE_SERVICE_KEY="<...>"
export OCR_STREAM_LABEL="premier_p1_court_central"
export OCR_YOUTUBE_URL="<LIVE_PREMIER_URL>"
export OCR_TOURNAMENT_ID="<UUID from public.tournaments>"
export OCR_COURT_LABEL="<court name matching public.matches.court>"
export OCR_WORKER_VERSION="$(git rev-parse --short HEAD)"

python -m src.main
```

Watch the logs (`structlog` JSON output). Expected: an `snapshot_written` log line every ~3 seconds with `confidence` > 0.5 and `parse_error: false`.

Run for ~2 minutes, then Ctrl+C.

Verify in Supabase SQL editor:
```sql
SELECT id, frame_at, match_id, parsed_score, ocr_confidence
FROM padelgod.ocr_snapshots
WHERE stream_label = 'premier_p1_court_central'
ORDER BY captured_at DESC
LIMIT 20;
```

Expected: ~40 rows (2min @ 3s/frame), confidence > 0.5, `parsed_score.parse_error = false` on most.

- [ ] **Step 5: Deploy to Railway**

Via Railway dashboard or CLI:
1. Create a new service in the existing Padel Nachos Railway project.
2. Source = this repo, root directory = `apps/ocr-worker`.
3. Set env vars (copy from Step 4, plus `OCR_FRAME_INTERVAL_SECONDS=3`).
4. Deploy.

Watch the deploy logs. Once "worker_starting" appears, verify snapshots are landing in Supabase (re-run the SQL from Step 4).

- [ ] **Step 6: Document the deployment in README**

Append to `apps/ocr-worker/README.md`:

```markdown
## Deployment

The worker is one Railway service per stream. To start watching a new stream:

1. Capture a sample frame from the stream (see Task 11 Step 1).
2. Measure the scoreboard bbox (Step 2).
3. Create `calibrations/<stream_label>.json` (Step 3).
4. Add a new Railway service pointing to this directory with the appropriate env vars (Step 5).
5. Verify snapshots are landing in `padelgod.ocr_snapshots`.

## Service list

| `stream_label` | Tournament | Court | Notes |
|---|---|---|---|
| `premier_p1_court_central` | Calibrated 2026-05-24 | Premier Padel central court | First V1 stream |
```

- [ ] **Step 7: Commit**

```bash
git add apps/ocr-worker/calibrations/premier_p1_court_central.json \
        apps/ocr-worker/README.md
git commit -m "feat(ocr-worker): deploy first Premier calibration to Railway"
```

---

## Task 12: `shadow-diff-ocr` TypeScript worker

**Files:**
- Create: `padelgod/src/workers/shadow-diff-ocr.ts`
- Create: `padelgod/src/workers/__tests__/shadow-diff-ocr.test.ts`
- Modify: `padelgod/src/scheduler.ts` (register the new worker)

**Spec reference:** §7

- [ ] **Step 1: Read the existing shadow-diff-finalizer pattern**

Open `padelgod/src/workers/shadow-diff-finalizer.ts` and `padelgod/src/workers/__tests__/shadow-diff-finalizer.test.ts` (if it exists). The new worker should follow the same shape:
- Exports `runShadowDiffOcr(deps: { supabase, logger? })`
- Returns a `ShadowDiffOcrResult` object with counters
- Uses `pino` logger

- [ ] **Step 2: Write the failing test**

Create `padelgod/src/workers/__tests__/shadow-diff-ocr.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runShadowDiffOcr } from '../shadow-diff-ocr.js';

describe('shadow-diff-ocr', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      execute: vi.fn(),
    };
  });

  it('classifies sets agreement as "match" when OCR and public.sets agree', async () => {
    // Setup: one ocr_snapshot resolved to a match, with sets [6-3]
    // public.sets has the same: pair1_games=6, pair2_games=3
    // Expect: insert one ocr_diff_events row with agreement='match'

    const matchId = '11111111-1111-1111-1111-111111111111';
    const snapshotId = 1;

    // Mock the snapshots-since-cutoff query
    supabase.schema.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue({
                  data: [{
                    id: snapshotId,
                    match_id: matchId,
                    frame_at: '2026-05-24T18:00:00Z',
                    parsed_score: {
                      sets_completed: ['6-3'],
                      current_game: '30-15',
                      pair1_label: 'COELLO TAPIA',
                      pair2_label: 'GALAN CHINGO',
                      parse_error: false,
                    },
                  }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    // Mock the public.sets fetch
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({
              data: [
                { set_number: 1, pair1_games: 6, pair2_games: 3 },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    // Mock the diff_events insert
    const insertMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
    });
    supabase.schema.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        insert: insertMock,
      }),
    });

    const result = await runShadowDiffOcr({ supabase });

    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement: 'match',
        match_id: matchId,
      }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd padelgod && npm test -- shadow-diff-ocr
```

Expected: FAIL — module `../shadow-diff-ocr.js` not found.

- [ ] **Step 4: Implement `shadow-diff-ocr.ts`**

Create `padelgod/src/workers/shadow-diff-ocr.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export interface ShadowDiffOcrDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** How far back to look for new snapshots. Default 5 minutes. */
  windowMinutes?: number;
}

export interface ShadowDiffOcrResult {
  snapshotsConsidered: number;
  diffsWritten: number;
  agreementCounts: Record<string, number>;
}

type Agreement =
  | 'match'
  | 'sets_disagree'
  | 'game_disagree'
  | 'both_disagree'
  | 'no_crionet_baseline'
  | 'pair_label_mismatch';

interface OcrSnapshotRow {
  id: number;
  match_id: string;
  frame_at: string;
  parsed_score: {
    sets_completed: string[];
    current_game: string | null;
    pair1_label: string | null;
    pair2_label: string | null;
    parse_error: boolean;
  };
}

interface PublicSetRow {
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
}

export async function runShadowDiffOcr(
  deps: ShadowDiffOcrDeps,
): Promise<ShadowDiffOcrResult> {
  const { supabase, logger, windowMinutes = 5 } = deps;
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { data: snapshots, error } = await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select('id, match_id, frame_at, parsed_score')
    .gte('captured_at', cutoff)
    .not('match_id', 'is', null)
    .order('frame_at', { ascending: false });

  if (error) {
    logger?.error({ error }, 'failed to fetch ocr_snapshots');
    throw error;
  }

  const snapshotRows = (snapshots ?? []) as OcrSnapshotRow[];

  // Keep only the latest snapshot per match in this window
  const latestByMatch = new Map<string, OcrSnapshotRow>();
  for (const s of snapshotRows) {
    if (!latestByMatch.has(s.match_id)) {
      latestByMatch.set(s.match_id, s);
    }
  }

  const agreementCounts: Record<string, number> = {};
  let diffsWritten = 0;

  for (const snap of latestByMatch.values()) {
    const { data: sets } = await supabase
      .from('sets')
      .select('set_number, pair1_games, pair2_games')
      .eq('match_id', snap.match_id)
      .order('set_number', { ascending: true });

    const agreement = classify(snap.parsed_score, (sets ?? []) as PublicSetRow[]);
    agreementCounts[agreement] = (agreementCounts[agreement] ?? 0) + 1;

    const lagMs = Date.now() - new Date(snap.frame_at).getTime();
    await supabase.schema('padelgod').from('ocr_diff_events').insert({
      match_id: snap.match_id,
      ocr_snapshot_id: snap.id,
      agreement,
      ocr_score: snap.parsed_score,
      crionet_score: sets ?? null,
      lag_seconds: Math.floor(lagMs / 1000),
    });
    diffsWritten += 1;
  }

  logger?.info(
    { considered: latestByMatch.size, diffsWritten, agreementCounts },
    'shadow-diff-ocr complete',
  );

  return {
    snapshotsConsidered: latestByMatch.size,
    diffsWritten,
    agreementCounts,
  };
}

function classify(
  ocr: OcrSnapshotRow['parsed_score'],
  crionetSets: PublicSetRow[],
): Agreement {
  if (ocr.parse_error) {
    return 'no_crionet_baseline'; // skip; nothing to compare
  }
  if (crionetSets.length === 0) {
    return 'no_crionet_baseline';
  }

  // Compare each completed set
  const ocrSetTuples = ocr.sets_completed.map((s) => s.split('-').map(Number));
  let setsAgree = true;
  for (let i = 0; i < ocrSetTuples.length; i += 1) {
    const ocrSet = ocrSetTuples[i];
    const crionetSet = crionetSets[i];
    if (!crionetSet) { setsAgree = false; break; }
    if (ocrSet[0] !== crionetSet.pair1_games || ocrSet[1] !== crionetSet.pair2_games) {
      setsAgree = false; break;
    }
  }

  // V1: only sets are compared. game-score comparison requires fetching
  // public.games which is V2 work (see spec §11).
  if (setsAgree) return 'match';
  return 'sets_disagree';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd padelgod && npm test -- shadow-diff-ocr
```

Expected: PASS.

- [ ] **Step 6: Register the worker in the scheduler**

Open `padelgod/src/scheduler.ts`. Find the section near line 23 that imports other workers:

```typescript
import { runShadowDiffFinalizer } from './workers/shadow-diff-finalizer.js';
```

Add directly after it:
```typescript
import { runShadowDiffOcr } from './workers/shadow-diff-ocr.js';
```

Find the union type around line 130-160 that lists worker names. Add `'shadow-diff-ocr'` to the union.

Find the `getWorkerRunner` switch around line 249. Add:
```typescript
case 'shadow-diff-ocr': return (deps) => runShadowDiffOcr({ supabase: deps.supabase, logger: deps.logger });
```

Find the registration list near line 531 (where workers are registered with their cron schedules). Add a new entry:
```typescript
{
  name: 'shadow-diff-ocr',
  schedule: '*/5 * * * *',  // every 5 minutes
  run: getWorkerRunner('shadow-diff-ocr')!,
},
```

- [ ] **Step 7: Verify scheduler builds**

Run:
```bash
cd padelgod && npm run build
```

Expected: clean build, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add padelgod/src/workers/shadow-diff-ocr.ts \
        padelgod/src/workers/__tests__/shadow-diff-ocr.test.ts \
        padelgod/src/scheduler.ts
git commit -m "feat(padelgod): shadow-diff-ocr worker comparing OCR to public.sets"
```

---

## Task 13: Ops API — `/api/internal/ocr-health` route (in `apps/ops/`)

**Files:**
- Create: `apps/ops/src/app/api/internal/ocr-health/route.ts`
- Create: `apps/ops/src/app/api/internal/ocr-health/__tests__/route.test.ts`

**Spec reference:** §8 (top stats panel)

**Conventions to match** (from existing `apps/ops/src/app/api/internal/padelgod-health/route.ts`):
- Auth via `await auth()` from `@/lib/auth`; reject if `!session?.user?.isOperator`
- Supabase via `serviceClient()` from `@/lib/supabase` (NOT `createServerSupabase`)
- `export const dynamic = 'force-dynamic'`
- Test mocks via `vi.hoisted` for both `@/lib/auth` and `@/lib/supabase`

- [ ] **Step 1: Inspect an existing apps/ops API route**

Read `apps/ops/src/app/api/internal/padelgod-health/route.ts` end-to-end to confirm the patterns above. Also skim `apps/ops/src/app/api/internal/player-equipment/__tests__/post-auto-end.test.ts` for the test mock shape (especially the `vi.hoisted` factory and chainable Supabase stub).

- [ ] **Step 2: Write the failing test**

Create `apps/ops/src/app/api/internal/ocr-health/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { GET } from '../route'

function buildSupabaseStub(opts: {
  diffEvents: Array<{ agreement: string; lag_seconds: number | null }>
  snapshots: Array<{ ocr_confidence: number | null }>
}) {
  let call = 0
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn(function (this: any) {
      call += 1
      return this
    }),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn(function (this: any) {
      // First .from('ocr_diff_events') chain returns diffEvents;
      // second .from('ocr_snapshots') chain returns snapshots.
      const promise = call === 1
        ? Promise.resolve({ data: opts.diffEvents, error: null })
        : Promise.resolve({ data: opts.snapshots, error: null })
      return promise
    }),
  }
}

describe('GET /api/internal/ocr-health', () => {
  beforeEach(() => {
    authMock.mockReset()
    serviceClientMock.mockReset()
  })

  it('returns 401 when no operator session', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: false } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns agreement counts and match rate', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        diffEvents: [
          { agreement: 'match', lag_seconds: 2 },
          { agreement: 'match', lag_seconds: 3 },
          { agreement: 'sets_disagree', lag_seconds: 4 },
          { agreement: 'no_crionet_baseline', lag_seconds: null },
        ],
        snapshots: [
          { ocr_confidence: 0.9 },
          { ocr_confidence: 0.8 },
          { ocr_confidence: null },
        ],
      }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.totalDiffs).toBe(4)
    expect(json.matchRate).toBeCloseTo(0.5)
    expect(json.agreementCounts.match).toBe(2)
    expect(json.agreementCounts.sets_disagree).toBe(1)
    expect(json.totalSnapshots).toBe(3)
    expect(json.meanConfidence).toBeCloseTo(0.85)
    expect(json.meanLagSeconds).toBeCloseTo(3)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run from the `apps/ops` directory:
```bash
cd apps/ops && npm test -- ocr-health
```

Expected: FAIL — module `../route` not found.

- [ ] **Step 4: Implement the route**

Create `apps/ops/src/app/api/internal/ocr-health/route.ts`:

```typescript
// apps/ops/src/app/api/internal/ocr-health/route.ts
//
// GET /api/internal/ocr-health
//
// Aggregate health view for the OCR worker shadow-diff pipeline.
// Reads padelgod.ocr_diff_events + padelgod.ocr_snapshots from the last
// 24 hours and computes the metrics rendered by the OCR Health tab.
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient() (cross-schema read into padelgod).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const WINDOW_HOURS = 24

interface DiffEventRow {
  agreement: string
  lag_seconds: number | null
}

interface SnapshotRow {
  ocr_confidence: number | null
}

interface HealthResponse {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()

  const { data: diffData, error: diffError } = (await supabase
    .schema('padelgod')
    .from('ocr_diff_events')
    .select('agreement, lag_seconds')
    .gte('checked_at', cutoff)) as { data: DiffEventRow[] | null; error: { message: string } | null }

  if (diffError) {
    return NextResponse.json({ error: diffError.message }, { status: 500 })
  }

  const diffRows = diffData ?? []
  const agreementCounts: Record<string, number> = {}
  let totalLag = 0
  let lagSamples = 0
  for (const row of diffRows) {
    agreementCounts[row.agreement] = (agreementCounts[row.agreement] ?? 0) + 1
    if (row.lag_seconds != null) {
      totalLag += row.lag_seconds
      lagSamples += 1
    }
  }

  const totalDiffs = diffRows.length
  const matchCount = agreementCounts['match'] ?? 0
  const matchRate = totalDiffs > 0 ? matchCount / totalDiffs : 0
  const meanLag = lagSamples > 0 ? totalLag / lagSamples : null

  const { data: snapData } = (await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select('ocr_confidence')
    .gte('captured_at', cutoff)) as { data: SnapshotRow[] | null; error: { message: string } | null }

  const snapRows = snapData ?? []
  const confidences = snapRows
    .map((s) => s.ocr_confidence)
    .filter((c): c is number => c != null)
  const meanConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null

  const body: HealthResponse = {
    windowHours: WINDOW_HOURS,
    totalDiffs,
    totalSnapshots: snapRows.length,
    matchRate,
    agreementCounts,
    meanLagSeconds: meanLag,
    meanConfidence,
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/ops && npm test -- ocr-health
```

Expected: 2/2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/api/internal/ocr-health/
git commit -m "feat(admin): /api/internal/ocr-health aggregation endpoint"
```

---

## Task 14: Ops API — `/api/internal/ocr-diff-label` route (in `apps/ops/`)

**Files:**
- Create: `apps/ops/src/app/api/internal/ocr-diff-label/route.ts`
- Create: `apps/ops/src/app/api/internal/ocr-diff-label/__tests__/route.test.ts`

**Spec reference:** §8 ("OCR was right / wrong" buttons)

**Convention difference from the old plan:** Operator identity comes from the Auth.js session (`session.user.email`), NOT from the request body. The frontend doesn't pass `operatorEmail` anymore.

- [ ] **Step 1: Write the failing test**

Create `apps/ops/src/app/api/internal/ocr-diff-label/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { authMock, serviceClientMock, updateMock, eqMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

function buildSupabaseStub() {
  // .schema('padelgod').from('ocr_diff_events').update({...}).eq('id', n) → { error: null }
  eqMock.mockResolvedValue({ data: [{ id: 1 }], error: null })
  updateMock.mockReturnValue({ eq: eqMock })
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    update: updateMock,
  }
}

beforeEach(() => {
  authMock.mockReset()
  serviceClientMock.mockReset()
  updateMock.mockReset()
  eqMock.mockReset()
})

describe('POST /api/internal/ocr-diff-label', () => {
  it('returns 401 when not operator', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: false } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('writes a "correct" label to notes', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(buildSupabaseStub())

    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.stringContaining('operator_label=correct'),
      }),
    )
    // Notes string should contain the session's operator email
    const updateArg = updateMock.mock.calls[0][0]
    expect(updateArg.notes).toContain('by=op@x.com')
  })

  it('rejects unknown labels', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'maybe' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects missing diffId', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/ops && npm test -- ocr-diff-label
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `apps/ops/src/app/api/internal/ocr-diff-label/route.ts`:

```typescript
// apps/ops/src/app/api/internal/ocr-diff-label/route.ts
//
// POST /api/internal/ocr-diff-label
//
// Operator labeling endpoint for the OCR Health tab's "OCR was right /
// wrong" buttons. Writes a one-line attribution string into
// padelgod.ocr_diff_events.notes including the labeling operator's email
// (sourced from the Auth.js session, not the request body).
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient().

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_LABELS = new Set(['correct', 'incorrect'])

interface RequestBody {
  diffId?: number
  label?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as RequestBody
  const { diffId, label } = body

  if (typeof diffId !== 'number' || !label || !ALLOWED_LABELS.has(label)) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 })
  }

  const operatorEmail = session.user.email ?? 'unknown'
  const note = `operator_label=${label} by=${operatorEmail} at=${new Date().toISOString()}`

  const supabase = serviceClient()
  const { error } = await supabase
    .schema('padelgod')
    .from('ocr_diff_events')
    .update({ notes: note })
    .eq('id', diffId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/ops && npm test -- ocr-diff-label
```

Expected: 4/4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/internal/ocr-diff-label/
git commit -m "feat(admin): operator labeling endpoint for OCR diff events"
```

---

## Task 15: Ops page — OCR Health route + tab (in `apps/ops/`)

**Files:**
- Create: `apps/ops/src/app/(app)/system/ocr-health/page.tsx` (server component, thin wrapper)
- Create: `apps/ops/src/app/(app)/system/ocr-health/_components/OcrHealthTab.tsx` (client component, fetches + renders)
- Modify: `apps/ops/src/components/Sidebar.tsx` (add nav entry under the "System" group)

**Spec reference:** §8

**Conventions to match** (from existing `apps/ops/src/app/(app)/system/padelgod-health/`):
- Page is a server component that just imports and renders the Tab; sets `metadata.title` and `dynamic = 'force-dynamic'`.
- Tab is a client component (`'use client'`) under `_components/`.
- Auth happens at the layout level via `(app)/layout.tsx` — the Tab does not need to check auth itself.
- Fetch the API directly via `fetch('/api/internal/ocr-health')` (same origin).
- Poll on a 30s interval.

- [ ] **Step 1: Read the existing pattern**

Read these for shape reference:
- `apps/ops/src/app/(app)/system/padelgod-health/page.tsx` — server wrapper
- `apps/ops/src/app/(app)/system/padelgod-health/_components/PadelgodHealthTab.tsx` — client tab w/ 30s polling
- `apps/ops/src/components/Sidebar.tsx` — find the `'System'` group (around line 46-55) where new System pages are registered

- [ ] **Step 2: Create the page server wrapper**

Create `apps/ops/src/app/(app)/system/ocr-health/page.tsx`:

```tsx
import OcrHealthTab from './_components/OcrHealthTab'

export const metadata = { title: 'OCR Health · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function OcrHealthPage() {
  return <OcrHealthTab />
}
```

- [ ] **Step 3: Create the Tab client component**

Create `apps/ops/src/app/(app)/system/ocr-health/_components/OcrHealthTab.tsx`:

```tsx
'use client'
// apps/ops/src/app/(app)/system/ocr-health/_components/OcrHealthTab.tsx
//
// V1 OCR Health tab — reads /api/internal/ocr-health and renders the
// graduation-decision metrics for the OCR worker shadow-diff pipeline.
//
// Polls every 30 seconds. No write operations from this file (the
// operator labeling buttons that POST to /api/internal/ocr-diff-label
// live alongside the disagreements table in V2 — out of scope here).

import { useEffect, useState } from 'react'

interface OcrHealthData {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
}

export default function OcrHealthTab() {
  const [data, setData] = useState<OcrHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const fetchData = async () => {
      try {
        const res = await fetch('/api/internal/ocr-health')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as OcrHealthData
        if (alive) {
          setData(json)
          setError(null)
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [])

  if (loading) return <div style={{ padding: 24 }}>Loading OCR health…</div>
  if (error) return <div style={{ padding: 24, color: 'crimson' }}>Error: {error}</div>
  if (!data) return null

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        OCR Health — last {data.windowHours}h
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Total snapshots" value={data.totalSnapshots.toLocaleString()} />
        <Stat label="Total diffs" value={data.totalDiffs.toLocaleString()} />
        <Stat
          label="Match rate"
          value={`${(data.matchRate * 100).toFixed(1)}%`}
          highlight={data.matchRate >= 0.95}
        />
        <Stat
          label="Mean confidence"
          value={data.meanConfidence != null ? data.meanConfidence.toFixed(2) : '—'}
          highlight={data.meanConfidence != null && data.meanConfidence >= 0.85}
        />
      </div>

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Agreement breakdown
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {Object.entries(data.agreementCounts).map(([k, v]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--border-subtle, #eee)',
                padding: '6px 0',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted, #777)' }}>
        Auto-refreshing every 30s. V1 thresholds for graduation: sets agreement ≥95%, confidence ≥0.85.
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle, #eee)',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted, #777)' }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: highlight ? 'var(--accent-green, #1a7f37)' : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  )
}
```

> **Style note:** apps/ops uses inline `style` props with CSS custom properties (matching the existing PadelgodHealthTab pattern), NOT Tailwind. If you see Tailwind classes in earlier drafts, replace them. If `apps/ops` later adopts Tailwind, this tab can migrate alongside.

- [ ] **Step 4: Register in the Sidebar**

Open `apps/ops/src/components/Sidebar.tsx`. Find the `'System'` group (around line 46-55). Add a new item to its `items` array:

```tsx
{ href: '/system/ocr-health', label: 'OCR Health' },
```

Place it logically — e.g., right after `'Shadow Mode'` since OCR Health is also a shadow-data observability view. Don't reorder anything else.

- [ ] **Step 5: Verify the page renders locally**

```bash
cd apps/ops
npm run dev
# → http://localhost:3004
```

Log in as an operator account (the apps/ops Auth.js flow — Google OAuth or email/password). Click "OCR Health" in the System group of the sidebar. Expected: page renders, shows zeros if no data, doesn't crash.

If the route returns 401, the session lookup is failing — verify you're logged in and that `session.user.isOperator` is true (per the `(app)/layout.tsx` gate).

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/\(app\)/system/ocr-health/ \
        apps/ops/src/components/Sidebar.tsx
git commit -m "feat(admin): OCR Health tab in System group"
```

---

## Final verification

After all 15 tasks land:

- [ ] **Smoke-test the full pipeline in production**

1. Confirm the Railway OCR worker is running (check Railway logs).
2. Confirm snapshots are being written: `SELECT count(*) FROM padelgod.ocr_snapshots WHERE captured_at > now() - interval '1 hour'` → expect ~1,200 for a single court.
3. Confirm shadow-diff-ocr is running: `SELECT count(*) FROM padelgod.ocr_diff_events WHERE checked_at > now() - interval '1 hour'` → expect 12 (one per 5min cron run, ~once per match per window).
4. Open `https://admin.padelnachos.com/system/ocr-health` (or `http://localhost:3004/system/ocr-health` locally) and confirm stats populate. The page is gated by Auth.js operator session — log in as a known operator account if redirected.

- [ ] **Begin the 2-week shadow measurement window**

Mark today's date as Day 0 of the shadow window. After 14 days, check the success criteria in spec §10:
- Agreement rate ≥ 95% on `sets_completed`
- Agreement rate ≥ 90% on `current_game` (note: V1 only diffs sets — `current_game` diff is V2)
- Stream uptime ≥ 98%
- Mean OCR confidence ≥ 0.85
- Zero false-resolution incidents

If all pass, open the V2 plan to extend the reconciler to consume OCR for FIP-tier matches with no Crionet source.

---

## Open follow-ups (spec §12)

- Investigate Premier Padel YouTube channel topology (one channel, multiple courts? Or multiple channels?) — informs whether `OCR_YOUTUBE_URL` needs to be a per-court URL or a channel resolver.
- Test scoreboard graphic stability across two different tournaments to detect if per-tournament calibration overrides are needed.
- Decide whether `padelgod.ocr_snapshots` needs PostgREST exposure (currently service-role-only via schema scope, matching existing padelgod tables).
