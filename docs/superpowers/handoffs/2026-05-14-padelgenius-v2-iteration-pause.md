# PadelGenius v2 — Session pause handoff (2026-05-14)

End-of-day snapshot of the **iteration phase** sitting on branch
`feature/padelgenius-v2-phase-1` (worktree at
`.worktrees/padelgenius-v2-phase-1`).

Phase 1 / 2 / 3 of the v2 design are all implemented and committed; the
draft PR is **#321** (kept in DRAFT mode while iterating). After Phase 3 we
spent multiple sessions polishing the editor and play screen. This document
captures what landed today + what's still in flight.

---

## How to resume tomorrow

```bash
# 1. Enter the worktree
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/padelgenius-v2-phase-1

# 2. Start the dev server (Turbopack can't follow the symlinked
#    node_modules — must use webpack)
npx next dev --webpack --port 3002
```

Visit:
- **`http://localhost:3002/ops?token=30143014`** — sets the httpOnly ops auth cookie (only needed once per browser)
- **`http://localhost:3002/padelgenius/play`** — the player-facing play screen
- **`http://localhost:3002/ops/padelgenius/courts`** — court library / calibration / branding / trajectories
- **`http://localhost:3002/ops/padelgenius/courts/club-deportivo`** — direct link to the active court editor (has REPLACE IMAGE button in header)
- **`http://localhost:3002/ops/padelgenius/editor`** — question editor with bottom-bar mode chips (`BASE` / `INTRO` / `A` `B` `C` `D`) and collapsible drawer

**Bitdefender Anti-Tracker hydration warning is benign** — open the editor in
an incognito window or disable the extension on `localhost:3002` to silence it.
The `bis_skin_checked="1"` attributes in the dev overlay are extension-injected, not from our code.

---

## What's shipping in this branch (against `main`)

### Phase 1 (committed up through `feat(padelgenius/editor): editor server entry page`)
The Duolingo-style play screen at `/padelgenius/play`:
- Cartoon court SVG composition (Scene, PlayerSprite, BallSprite, TrajectoryRenderer)
- Tap-to-pick + CONFIRM flow with state machine in PlayMode
- 8 trajectory styles, 4 player sprites, 9 silent audio placeholders
- Slim RevealSheet with optional "Why?" explanation
- Right-wall tilted progress bar
- 5-question lessons drawn from the migrated question bank (44 questions)
- prefers-reduced-motion respected
- 30+ unit tests (projection, trajectories, scoring, swooshFor)

### Phase 2 (committed)
Court management at `/ops/padelgenius/courts/[slug]`:
- 4 tabs: DIMENSIONS / ZONES / BRANDING / TRAJECTORIES
- 14-slider calibration (9 bounds + 5 visual system)
- Trapezoid-aware zone visualization
- 5 sponsor branding slots (back wall / side glass × 2 / net band / floor center)
- Upload-new-court flow with auto thumbnail
- Atomic activate (only one active court at a time)

### Phase 3 (committed)
Visual question editor at `/ops/padelgenius/editor`:
- Question list (collapsible)
- Drag handles for players / letters / ball / trajectory endpoints
- Validation banner + TEST PLAY modal
- Form drawer with full per-option editing

### Iteration phase (TODAY, uncommitted — about to land in chunks below)

| Capability | What it does | Files |
|---|---|---|
| **Editor redesign** | Court takes most of the screen. Drawer collapses by default. New mode chip row (BASE / INTRO / A B C D). Mode hint above chips. | `Editor.tsx`, `QuestionList.tsx`, `CourtPreview.tsx` |
| **Real sprite drag handles** | Player chibis / yellow ball replace abstract circle handles in the editor. Depth-sorted, animated. | `CourtPreview.tsx`, `DragHandle.tsx` (renderHandle slot), `PlayerSprite.tsx`, `BallSprite.tsx` |
| **CSS-transform animation** | Player + ball smoothly glide between positions (700 ms ease-out). Disabled in editor drag context via `animatePosition={false}`. | `PlayerSprite.tsx`, `BallSprite.tsx` |
| **Trajectory preview on tap** | Tapping a letter shows a faded blue dashed line for that option BEFORE the user confirms. | `Scene.tsx` |
| **Players animate on tap (not confirm)** | Selecting an option moves players to that option's overrides immediately; ball glides to its `setupBall`. | `Scene.tsx` |
| **Per-option player overrides** | Gold halo around overridden players + dotted lead-line from base position. Drag in option mode → updates overrides. | `CourtPreview.tsx`, `Editor.tsx` |
| **Per-option setup ball** | `outcome.setupBall` (new field). Ball glides to it during preview phase. Editor toolbar has BALL OVERRIDE / + ADD BALL controls. | `types.ts`, `Scene.tsx`, `CourtPreview.tsx`, `Editor.tsx` |
| **Optional trajectory** | `outcome.trajectory` is now optional. TRAJECTORY ON/OFF toggle. Rules / positioning questions reveal without a flight line. | `types.ts`, `Scene.tsx`, `CourtPreview.tsx`, `OptionRow.tsx`, `PlayMode.tsx`, `question-validation.ts` |
| **APEX curve control** | Purple drag handle shapes the curve via a quadratic Bezier through it. Reset to style default with one click. | `trajectories.ts`, `TrajectoryRenderer.tsx`, `Scene.tsx`, `CourtPreview.tsx`, `Editor.tsx` |
| **Custom trajectory assets** | Per-court upload of PNG/SVG for each of 8 styles. Rotated/scaled along the chord direction at render time. | `types.ts`, `TrajectoriesTab.tsx` (new), trajectory upload route (new), `TrajectoryRenderer.tsx`, `Scene.tsx`, `CourtPreview.tsx` |
| **Per-style line overrides** | Color picker, thickness slider, dashed toggle, decorations on/off for the procedural line. Live swatch preview. | `types.ts`, `TrajectoriesTab.tsx`, `TrajectoryRenderer.tsx`, courts PATCH route |
| **Replace court image** | Cyan REPLACE IMAGE button in CourtEditor header. Auto-regenerates thumbnail. Cache-bust via `?v=<ts>`. | image upload route (new), `CourtEditor.tsx` |
| **Trapezoid-aware zones** | ZonesTab bands now follow the court trapezoid (SVG polygons via `toSvg`) instead of full-width rectangles. | `ZonesTab.tsx` |
| **Cartoon trajectory line** | Hard drop shadow under the procedural line. Smaller chunky arrowhead at endpoint with rounded joins. | `TrajectoryRenderer.tsx`, `CourtPreview.tsx` |
| **Flat curve / Bandeja deeper arc** | `flat` is no longer ruler-straight — uses the old bandeja shape. `bandeja` apex pulled higher (-55 vs -20). | `trajectories.ts`, `trajectories.test.ts` |
| **CONFIRM → green check button** | Round 32×32 disc with chunky black tick instead of the old 70×26 "CONFIRM" pill. Saves screen space. | `PositionedOptions.tsx` |
| **Inline trajectory toggle in drawer** | OptionRow form drawer has a full-width pill button to add/remove the trajectory for that option. | `OptionRow.tsx` |
| **Intro animation (multi-segment)** | New `question.court.intro` with `segments: Trajectory[]`. Plays once on question load before any tap. INTRO chip in editor toolbar adds per-segment drag handles + style chips + remove buttons. | `types.ts`, `trajectories.ts` (`introSegments` helper), `Scene.tsx`, `Editor.tsx`, `CourtPreview.tsx` |
| **Ball height illusion** | Ground shadow ellipse below the ball during intro animation (rx pulses smaller at apex). Ball radius pulses bigger at apex (`r: 9 → 12 → 9`). | `Scene.tsx` |
| **`animateMotion` fix** | `BallSprite` motionPath branch now uses `cx=0 cy=0` so SMIL drives absolute position. Fixes the "ball outside the court" bug for both intro and reveal animations. | `BallSprite.tsx` |
| **Operator calibration** | Saved `bounds.netY = 0.555`, `nearServiceY = 0.83`, `playerBaseSize = 80`, `progressBarTilt = -11`, `zones.attackDepth = 10`, `transitionDepth = 18` for Club Deportivo. New court PNG + thumb. | `public/padelgenius/courts/club-deportivo/config.json` + `court.png` + `thumb.png` |

---

## Key UI flows to remember

### Editor — three drag modes via bottom chip row

```
[BASE] | INTRO | A B C D
```

| Chip active | Dragging a player updates… | Dragging the ball updates… |
|---|---|---|
| **BASE** (default) | `question.court.players` (the starting positions) | `question.court.ball` (the visible setup ball) |
| **INTRO** | (players uneditable in intro mode) | (intro uses its own segment handles instead) |
| **A / B / C / D** | that option's `outcome.playerOverrides` (gold halo) | that option's `outcome.setupBall` (gold halo, optional override) |

### Editor — INTRO mode toolbar

```
INTRO · INTRO ON · ① flat · ② wall-bounce ✕ · + SEGMENT
```

- Color-coded chip per segment (cyan, orange, pink, lime, purple — cycles)
- Click style chip to cycle through 8 trajectory styles
- `✕` next to each chip removes that segment (disabled when only 1 left)
- `+ SEGMENT` (orange) appends a new segment starting at the previous endpoint
- Drag handles on the court: FROM (segment 1 only), P1 / P2 / END for each endpoint, APEX per segment

### Play screen — what happens on tap → confirm

1. **Idle** — intro animation plays once if defined (ball glides through all segments, shadow + scale pulse for height)
2. **Tap a letter** → letter highlights blue, players animate to that option's `playerOverrides`, ball glides to its `setupBall`, blue dashed preview trajectory appears
3. **Tap green check** → trajectory animates with ball flying along it, cartoon arrow at landing, sparkle on correct, reveal sheet slides up
4. **Tap CONTINUE** → next question loads, fade-in animation

---

## Data model anchors

```ts
// src/lib/padelgenius/types.ts (most relevant additions today)

export interface IntroAnimation {
  segments?: Trajectory[]      // NEW preferred shape
  trajectory?: Trajectory      // @deprecated legacy
  bounce?: Trajectory          // @deprecated legacy
  durationMs?: number
}

export interface Trajectory {
  from: [number, number]
  to: [number, number]
  style: TrajectoryStyle
  controlPoint?: [number, number]  // user-set apex
}

export interface Outcome {
  ball: { x: number; y: number }
  trajectory?: Trajectory          // optional now
  playerOverrides?: PlayerPosition[]
  setupBall?: { x: number; y: number }
}

export interface CourtConfig {
  // …existing 9 bounds + zones + visualSystem + branding…
  trajectoryAssets?: TrajectoryAssets       // per-style PNG uploads
  trajectoryOverrides?: TrajectoryOverrides // per-style color / thickness / dash / decorations
}

export interface TrajectoryStyleOverride {
  color?: string
  strokeWidth?: number
  dashed?: boolean
  showDecorations?: boolean
}
```

Helper: `introSegments(intro)` in `src/lib/padelgenius/trajectories.ts` returns
the segments array, falling back to `[trajectory, bounce]` for legacy data.

---

## Known follow-ups (not blocking)

| Item | Notes |
|---|---|
| **Custom trajectory PNG asset uploads** | UI ships; user still needs to generate 8 assets via the prompt template in the earlier chat (or any LLM image gen). Drop into TRAJECTORIES tab. |
| **Audio** | 9 placeholder MP3s are silent dummy bytes. Real cartoon clips needed before launch. Hook tolerates missing/invalid files. |
| **i18n** | Question bank + HintPill + reveal labels ship English-only. Migration to 5 locales is a separate task. |
| **RTL smoke tests for PlayMode** | Deferred. `swooshFor` is unit-tested; full state-machine validation moves to manual QA. |
| **PR #321** | Currently DRAFT. Open it from `https://github.com/gudenes/padel-live-scores/pull/321`. Ready to mark as ready-for-review when you decide the iteration is done. |
| **Bitdefender hydration noise** | Browser extension, not a code issue. Test in incognito or disable on localhost. |

---

## File census at pause (post-commit)

After the chunked commits below land, working tree should be clean
(`git status --short` returns nothing). Run a final check before closing the lid:

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/padelgenius-v2-phase-1
git status
git log --oneline main..HEAD | head -10
```

---

## If you want to ship

1. Manual QA pass — walk through each chip mode, intro animation, asset upload, replace image
2. Convert PR #321 from draft to ready-for-review: `gh pr ready 321`
3. Generate the 8 trajectory PNGs (or skip — the procedural lines are now genuinely cartoon-y on their own)
4. Drop real audio clips into `public/padelgenius/sounds/`
5. Merge to main when comfortable
