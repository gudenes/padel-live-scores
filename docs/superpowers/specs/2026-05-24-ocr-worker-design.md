# OCR Worker — Broadcast-Derived Score Source

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-24)
**Related:** [Padel Labs B2B handoff](../../padel_labs_handoff.md) (strategic context)

## 1. Goal

Add a new live-data source that reads padel scores directly from broadcast video by running OCR on the on-screen scoreboard graphic of YouTube live streams. The worker writes immutable, source-tagged snapshots to a dedicated `padelgod` schema table.

**V1 is shadow-only.** OCR snapshots are written, accuracy is measured against Crionet (the current Premier-tier truth source), and zero data flows into `public.matches` or `public.sets`. The validation period produces the evidence we need before promoting OCR to a real writer.

**V1 value is the pattern, not the data.** Shipping this proves OCR is accurate enough to be the FIP-tier primary live-score source (the actual product win — Bronze/Silver/Gold have no live scoring today) and the Premier-tier resilience layer (Crionet fallback + future server-identity capture).

## 2. Out of scope (V1)

- **Writing to `public.matches` or `public.sets`.** Shadow only. No consumer-facing impact.
- **Server identity / who-is-serving.** Deferred to V2 once V1 score accuracy is proven.
- **FIP-tier primary writer path.** Deferred to V2 — needs proven shadow numbers first.
- **Multi-stream from a single worker process.** One Railway service per stream in V1. Multiplexing is V2 work, only worth the complexity at 4+ concurrent streams.
- **Auto-detection of scoreboard region.** Manual per-stream calibration JSON is sufficient for Premier (one layout) and early FIP (1-3 layouts/season). Template-matching auto-detection is V2/V3 when amateur/federation streams enter scope.
- **Match-event reconstruction (point-by-point by frame diffing).** V3+ at earliest. Fragile, doesn't earn its keep until we're selling deep stats.
- **The full event-sourced observations / consensus / disagreements schema** proposed in the Padel Labs handoff. V1 uses the existing `padelgod` snapshot pattern. The observations layer is deferred to whenever a betting-data contract is on the table.
- **Backfill of historical broadcasts.** Forward-only.
- **Embed / hosting of YouTube content.** OCR reads public HLS streams. No re-broadcast, no storage of long-form video.

## 3. Why now

Current live-data coverage on padelnachos:

| Tier | Live point-by-point | Live final score | Stats |
|---|---|---|---|
| **Premier** (P1, P2, Major) | ✓ via Crionet widgets | ✓ via Crionet + padelapi | ✓ via Crionet `getmatchstats` |
| **FIP** (Bronze/Silver/Gold) | ✗ no source | partial (via OOP + results writers, post-finish) | ✗ none |

The FIP-tier gap is the user-visible product hole. OCR is the cheapest source that closes it — public YouTube streams + a CPU-only worker, no API contracts.

For Premier-tier (V2), OCR adds two specific things Crionet doesn't:
- **Server identity** — the scoreboard graphic shows which player is serving; Crionet's score API does not expose this. Useful for momentum visualization and the "who's on serve at break point" stat.
- **Resilience** — when Crionet's widget endpoint errors or lags (it has, multiple times), OCR is a parallel signal that keeps the live page from going stale.

V1 ships only the Premier shadow path because Crionet gives us ground truth to validate OCR against. Without that baseline, an OCR error would ship straight to users.

## 4. Architecture

```
[Premier Padel YouTube live URL (env-configured per worker for V1)]
         ↓
apps/ocr-worker/   ← new Python service on Railway
  ├─ stream_capture.py    yt-dlp pulls latest HLS segment every N seconds
  ├─ frame_extract.py     ffmpeg/opencv extracts most-recent frame from segment
  ├─ scoreboard_crop.py   fixed-coordinate crop using per-stream calibration JSON
  ├─ ocr.py               pytesseract reads digits, returns text + per-char confidence
  ├─ parse.py             text → structured score
  ├─ resolver.py          (court_label + tournament_id + frame_at) → match_id
  ├─ snapshot_writer.py   INSERT into padelgod.ocr_snapshots
  └─ main.py              orchestrator loop, one stream per worker process
         ↓
padelgod.ocr_snapshots   ← new append-only table
         ↓
padelgod/src/workers/shadow-diff-ocr.ts   ← new TS worker (padelgod scheduler)
         ↓
padelgod.ocr_diff_events   ← agreement / disagreement records
         ↓
src/app/ops/ocr-health/    ← new ops dashboard tab
```

**Boundary discipline:** the Python OCR worker only writes to `padelgod.ocr_snapshots`. It never touches `public.*`. The TypeScript `shadow-diff-ocr` worker reads both and writes only to `padelgod.ocr_diff_events`. No path from OCR output to `public.matches` exists in V1 — by design.

## 5. Data model

Two new tables, both in the `padelgod` schema (not `public`) — same isolation pattern as existing `padelgod.oop_snapshots`, `padelgod.results_snapshots`, etc.

### 5.1 `padelgod.ocr_snapshots`

```sql
CREATE TABLE padelgod.ocr_snapshots (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Ingestion timing
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- when we wrote it
  frame_at         TIMESTAMPTZ NOT NULL,                  -- when the frame was sampled
                                                          -- (captured_at - HLS delay ~10-30s)

  -- Stream identity
  youtube_video_id TEXT NOT NULL,           -- e.g. 'dQw4w9WgXcQ'
  stream_label     TEXT NOT NULL,           -- operator-supplied: 'premier_p1_court_central'

  -- Match resolution (nullable — resolved at insert if possible, else by sweeper)
  tournament_id    UUID REFERENCES public.tournaments(id),
  match_id         UUID REFERENCES public.matches(id),
  court_label      TEXT,                    -- 'Pista Central', 'Court 2' — env-supplied or parsed

  -- OCR output
  parsed_score     JSONB NOT NULL,
  -- shape: {
  --   "sets_completed": ["6-3", "4-2"],
  --   "current_game":   "30-15",
  --   "pair1_label":    "COELLO TAPIA",   -- raw OCR'd name string
  --   "pair2_label":    "GALAN CHINGO",
  --   "parse_error":    false             -- true if tesseract output was unparseable
  -- }
  raw_text         TEXT,                    -- full tesseract output, for debug
  ocr_confidence   NUMERIC(4,3) CHECK (ocr_confidence BETWEEN 0 AND 1),

  -- Debug / lineage
  frame_storage_path TEXT,                  -- Supabase Storage path if frame retained
  worker_version   TEXT NOT NULL            -- git SHA of ocr-worker that produced this
);

CREATE INDEX idx_ocr_match_time
  ON padelgod.ocr_snapshots (match_id, frame_at DESC)
  WHERE match_id IS NOT NULL;

CREATE INDEX idx_ocr_stream_time
  ON padelgod.ocr_snapshots (stream_label, frame_at DESC);

CREATE INDEX idx_ocr_unresolved
  ON padelgod.ocr_snapshots (captured_at DESC)
  WHERE match_id IS NULL;
```

**Design decisions baked in:**

- **No supersede chain.** Frames are independent. ~1 OCR snapshot every 3s = ~1,200 rows per court-hour, ~10K per tournament-day per court. Predictable, no UPDATE pattern needed.
- **Match resolution is two-phase.** Worker tries to resolve at write time via `(tournament_id, court_label, frame_at within ±4h, status='live')`. On miss (gap between matches, race condition, ambiguous match) → write with `match_id = NULL`. A sweeper retries unresolved rows. Same pattern as `match_stats_unresolved`.
- **Pair labels are kept raw** even when `match_id` is resolved. They're a sanity check: if OCR reads `COELLO TAPIA` but the resolved match is Tapia/Coello vs Stupa/DiNenno, the resolution is wrong and the diff worker can flag it.
- **Frame storage is selective.** Frames with `ocr_confidence < 0.7` OR a random 1% sample are uploaded to a Supabase Storage `ocr-frames` bucket. Bounded storage cost, debug dataset for the 1% that matter.
- **No RLS.** Schema isolation does the work — `padelgod` schema is not exposed via PostgREST (same as existing padelgod tables). Service-role-only by virtue of schema scope.
- **No retention policy in V1.** Table reaches ~1M rows in 3 months at full production rates. Monthly partitioning + 6-month drop is V2 work.
- **Cross-schema FKs to `public.matches` and `public.tournaments`** are accepted — they enforce that we never write snapshots attributed to nonexistent matches once resolution happens.

### 5.2 `padelgod.ocr_diff_events`

```sql
CREATE TABLE padelgod.ocr_diff_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id        UUID NOT NULL REFERENCES public.matches(id),
  ocr_snapshot_id BIGINT NOT NULL REFERENCES padelgod.ocr_snapshots(id),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  agreement       TEXT NOT NULL CHECK (agreement IN (
                    'match', 'sets_disagree', 'game_disagree',
                    'both_disagree', 'no_crionet_baseline', 'pair_label_mismatch'
                  )),
  ocr_score       JSONB NOT NULL,
  crionet_score   JSONB,                 -- NULL when 'no_crionet_baseline'
  lag_seconds     INT,                   -- ocr.frame_at vs sets.updated_at
  notes           TEXT                   -- free-form, used by operator labeling buttons
);

CREATE INDEX idx_diff_match ON padelgod.ocr_diff_events (match_id, checked_at DESC);
CREATE INDEX idx_diff_disagreements ON padelgod.ocr_diff_events (checked_at DESC)
  WHERE agreement != 'match';
```

The `no_crionet_baseline` case is informative on purpose — it measures how often Crionet **misses** data that OCR captures. That's the resilience-value story made measurable.

## 6. Worker loop & runtime behavior

### 6.1 Main loop (Python pseudocode)

```python
while not stop_signal:
    1. segment = yt_dlp.fetch_latest_hls_segment(youtube_url)
       # ~10s playlist refresh interval; latest segment is 2-6s of video
    2. frame  = ffmpeg.extract_last_frame(segment)
    3. crop   = scoreboard_crop(frame, calibration[stream_label])
    4. prep   = preprocess(crop)  # grayscale → threshold → 2x upscale
    5. text, char_confidences = pytesseract.image_to_data(prep)
    6. parsed = parse_score(text)  # → {sets_completed, current_game, pair1_label, pair2_label}
    7. match_id = resolve_match_id(court_label, tournament_id, frame_at)  # may be None
    8. supabase.table('ocr_snapshots').insert({...})
    9. if mean(char_confidences) < CONFIDENCE_THRESHOLD or random() < 0.01:
           upload_frame_to_storage(crop, snapshot_id)
   10. sleep(max(0, FRAME_INTERVAL - elapsed))
```

**Frame rate: 1 every 3 seconds.** Padel point cadence is 6-20s typically; score updates are infrequent. 3s gives ~1,200 frames/hour, comfortably within Python tesseract throughput (~5-10 frames/s on a single Railway vCPU). Adjustable per-stream via `OCR_FRAME_INTERVAL_SECONDS` env var.

### 6.2 Scoreboard calibration

Per-stream JSON files at `apps/ocr-worker/calibrations/<stream_label>.json`:

```json
{
  "stream_label": "premier_p1_court_central",
  "scoreboard_bbox": [x, y, width, height],
  "row_layout": "two_pair_horizontal",
  "set_columns": [{"x": 100, "width": 40}, {"x": 145, "width": 40}],
  "game_column": {"x": 200, "width": 60},
  "pair_label_column": {"x": 0, "width": 90}
}
```

Calibration is operator work — produced once per broadcast layout in a Jupyter notebook by clicking corners on a screenshot. ~10 minutes per layout. V1 ships with 1 calibration (the first Premier court targeted).

The worker fails fast at startup if `OCR_STREAM_LABEL` has no matching calibration JSON. No silent degradation.

### 6.3 Error handling

| Failure | Behavior |
|---|---|
| Stream ended / HTTP 404 from yt-dlp | Log gap. Poll YouTube channel live endpoint every 60s for resumption. Exit cleanly after 30min of no resumption (Railway restarts per its policy). |
| Tesseract returns gibberish (confidence < 0.3) | Insert snapshot with `parsed_score.parse_error = true`. Shadow-diff filters these. Retain frame to storage. |
| Frame has no scoreboard visible (replay / crowd / sponsor) | Preprocessing detects low edge density in scoreboard region → skip frame, no DB write. |
| Network error fetching HLS segment | Exponential backoff (1s, 2s, 4s, 8s, 16s), max 5 retries, then mark stream unhealthy and surface in OCR Health tab. |
| Match resolution finds 0 or 2+ candidate matches | Write snapshot with `match_id = NULL`. Sweeper retries every 5min. |
| Supabase insert fails | In-memory buffer of last N snapshots, retry on next loop iteration. Drop after 50 buffered (worker is unhealthy at that point). |

### 6.4 Match resolution

```python
def resolve_match_id(court_label, tournament_id, frame_at):
    # Find a live match on this court within ±4h of frame_at
    candidates = supabase.table('matches') \
        .select('id, pair1_player1_id, ..., status') \
        .eq('tournament_id', tournament_id) \
        .eq('court', court_label) \
        .eq('status', 'live') \
        .gte('scheduled_at', frame_at - timedelta(hours=4)) \
        .lte('scheduled_at', frame_at + timedelta(hours=4)) \
        .execute()
    if len(candidates) == 1:
        return candidates[0]['id']
    return None  # 0 or 2+ → sweeper will retry
```

Two known race conditions handled by the sweeper:
- Court swap (match moved courts mid-tournament) → no live match on this court at frame_at → sweeper re-resolves after `public.matches.court` is updated by `fip-oop-writer`.
- Match-end gap (match just finished, next not yet `status='live'`) → sweeper resolves once next match flips.

## 7. Shadow-diff worker

New TypeScript worker at `padelgod/src/workers/shadow-diff-ocr.ts`. Registered in `padelgod/src/scheduler.ts` to run every 5 minutes.

```
For each match with new RESOLVED ocr_snapshots in the last 5 minutes
(i.e. match_id IS NOT NULL — unresolved snapshots are handled by the resolution sweeper):
  1. Pull the latest ocr_snapshot for that match
  2. Pull current public.sets rows for that match (Crionet-fed)
  3. Pull current games row for the current set (Crionet-fed)
  4. Compare:
     - sets_completed (OCR) vs (pair1_games, pair2_games) per set in public.sets
     - current_game (OCR) vs games.game_score on the current set
     - pair1_label / pair2_label vs the actual match's player names (token similarity ≥ 0.5)
  5. Classify agreement: 'match' | 'sets_disagree' | 'game_disagree'
     | 'both_disagree' | 'pair_label_mismatch' | 'no_crionet_baseline'
  6. INSERT into padelgod.ocr_diff_events
```

Pair-label mismatch is checked separately from score agreement — a label mismatch usually means **wrong match was resolved**, which invalidates the score comparison. The diff worker treats it as its own category.

## 8. Ops dashboard — "OCR Health" tab

New tab at `src/app/ops/ocr-health/page.tsx`, sibling to existing Integration Health.

**Top stats panel (last 24h, filterable):**
- Total snapshots written
- Match rate (% of comparisons where `agreement = 'match'`)
- Disagreement breakdown bar (sets / game / both / pair-label)
- Crionet-miss rate (% of frames where `agreement = 'no_crionet_baseline'`)
- Mean OCR confidence, p10 confidence

**Recent disagreements table:**
- Columns: match, time, OCR-said, Crionet-said, agreement type, confidence, frame thumbnail (if retained)
- Two action buttons per row: **"OCR was right"** / **"OCR was wrong"** → writes to `padelgod.ocr_diff_events.notes` as `operator_label=correct|incorrect` with operator email + timestamp.
- This produces a ground-truth labeled set without requiring a separate labeling pipeline.

**Stream health panel:**
- Per stream_label: last snapshot age, last-100-frames mean confidence, current state (capturing / stream-down / unhealthy), Railway service status.

This tab is the **single artifact** that decides V1 graduation. The success criteria in §10 read directly from these numbers.

## 9. Deployment

### 9.1 Service topology

New Railway service `ocr-worker` alongside existing `relay` and `padelgod`. One Railway process per stream in V1 (= one service for the first Premier court).

**Stack:** Python 3.12, `pyproject.toml` with:
- `pytesseract` (OCR)
- `opencv-python-headless` (frame ops, no GUI deps)
- `yt-dlp` (HLS fetching)
- `httpx` (HTTP)
- `supabase-py` (DB)

**Dockerfile:** `python:3.12-slim` base + `apt-get install tesseract-ocr ffmpeg`. ~150MB final image.

### 9.2 Configuration (env vars)

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
OCR_STREAM_LABEL              # e.g. 'premier_p1_court_central'
OCR_YOUTUBE_URL               # full YouTube live URL
OCR_TOURNAMENT_ID             # UUID of currently-running tournament
OCR_COURT_LABEL               # e.g. 'Pista Central' — must match public.matches.court
OCR_FRAME_INTERVAL_SECONDS    # default 3
OCR_CONFIDENCE_THRESHOLD      # default 0.7 (below = retain frame to storage)
OCR_WORKER_VERSION            # injected at build from git SHA
```

Operator workflow to start watching a tournament: set env vars in Railway → redeploy. ~2 minutes. No code change.

### 9.3 Cost

V1 marginal cost is immaterial against existing Railway + Supabase plans. OCR adds ~0.2-0.5 vCPU sustained, ~256-512MB RAM, and ~1.5GB/hour HLS bandwidth per stream when capturing. At one stream watching ~8h/day during a tournament week, that's order of $5-10/month of incremental Railway usage — lost in the noise of existing services.

Supabase additions are essentially $0: ~60MB/month of DB rows per stream and <10MB/month of selectively retained frames in Storage.

Capacity planning matters only at ~10+ simultaneous streams (a major-event scenario), where Railway bandwidth or compute caps may need a plan check. Addressed by V2 multi-stream worker design, not V1.

## 10. Success criteria — when V1 graduates from shadow

V1 is **ready to flip from shadow to FIP-tier primary** (V2 work) when, over a 2-week measurement window on the OCR Health tab:

1. **Agreement rate ≥ 95%** on `sets_completed` vs Crionet
2. **Agreement rate ≥ 90%** on `current_game` vs Crionet (lower bar — point-by-point churn is harder to align on the same instant)
3. **Stream uptime ≥ 98%** — worker not crash-looping or stuck
4. **Mean OCR confidence ≥ 0.85**
5. **Zero false-resolution incidents** — no observed cases of OCR snapshots attributed to the wrong match (caught by pair-label sanity check)

If any criterion fails at 2 weeks, V1 stays in shadow and the specific failure mode is iterated on (calibration adjustment, preprocessing tweak, parser fix) before V2 work starts.

## 11. V2 roadmap (rough order, all explicitly out of V1 scope)

1. **Server identity capture** — Premier scoreboard has a clear server-indicator dot/arrow. Adds a discriminator no other source provides.
2. **FIP-primary writer path** — extend `static-reconciler` to consume `ocr_snapshots` for matches where no Crionet source exists. This is the user-visible product win.
3. **Multi-stream worker** — single Python process spawning N stream-handler threads. Earns its complexity at 4+ concurrent streams.
4. **Partitioning + retention** — monthly partitions on `ocr_snapshots`, 6-month drop policy on closed partitions.
5. **Calibration UI** — browser-based crop-box drawer in the ops dashboard. Operator drops a screenshot, drags a box, saves JSON. Cuts calibration time from 10 min to 1 min.
6. **Template-matching fallback** — when no calibration JSON is configured for a stream, use OpenCV `matchTemplate` against a reference scoreboard PNG. Enables ad-hoc streams without per-broadcast calibration.

## 12. Open questions for implementation

- **Premier Padel YouTube channel topology** — one channel with multiple concurrent live broadcasts (per court), or multiple channels? Determines whether `OCR_YOUTUBE_URL` is a per-court URL or a channel that needs live-stream resolution. Investigate during week 1.
- **Scoreboard graphic stability across tournaments** — does Premier Padel use the exact same scoreboard layout at every tournament, or do sponsor overlays change crop coords? If the latter, calibration may need a per-tournament override.
- **Whether to expose `padelgod.ocr_snapshots` via PostgREST** for the ops dashboard, or read through the existing `padelgod` service-role pattern. Existing precedent (`oop_snapshots` etc.) is service-role only — recommend matching.
