# PPL Phase 2b — Results, lineups and statistics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill in what Phase 2a could not — who actually played each Pro Padel League match, what the score was, and the per-match statistics. This is what makes a PPL match appear on a player's profile.

**Architecture:** A second one-shot script, same shape as `import-ppl-season.ts`: dry-run by default, `--apply` to write, idempotent. Playwright is required because scores and lineups come from Firestore at runtime and exist only in the rendered DOM. Browser work is split from parsing: the page-side `evaluate` returns raw JSON, and a pure module turns that JSON into typed results, so the parser is testable against a captured fixture without a browser.

**Tech Stack:** TypeScript, `tsx`, Playwright, Vitest, Supabase JS.

**Spec:** `docs/superpowers/specs/2026-09-22-pro-padel-league-design.md`
**Depends on:** Phase 2a, already applied — 5 tournaments, 52 ties and 72 matches exist, and all 132 PPL player slugs are registered in `entity_external_ids`.

---

## Why this phase exists as its own thing

Phase 2a wrote 72 matches with **zero player FKs**. Upstream's static payload publishes only franchise-versus-franchise; it never says which two people took the court. Until this phase lands, no PPL match appears on any player profile and the feature's entire premise is unfulfilled.

## What the page actually gives us — measured 2026-09-23

Verified by driving a real match page from the production Railway container. Selectors are stable BEM.

### Lineups and per-player stats — `.player-spotlight__card--match-detail`

Exactly four cards per match, one per player. Each carries the **team name**, a `/player/<slug>/` link, and that player's own numbers:

```
SAN DIEGO STINGRAYS | LETIZIA MANQUILLO | SPAIN | VIEW PROFILE |
SERVE | 1ST IN | 97% | ACES | 0 | DF | 0 |
POINTS | SMASH | 11 | BANDEJA | 0 | VOLLEY | 6 | VIBORA | 1 | GROUND | 0 | LOB | 0 | OTHER | 0
```

**This is the single most important finding in the phase.** The card carries the slug, so players resolve by `entity_external_ids (source='ppl', external_id=<slug>)` — a direct lookup. No name matching, no fuzzy, none of the machinery Phase 2a needed. And the card names the team, so assigning each player to the right pair is unambiguous.

### Score — `.match-detail-scoreboard .cc-bcast-row`

One row per pair, carrying everything:

```
{ winner: false, team: "Toronto Polar Bears",
  players: ["NOEMI AGUILAR", "JANA MONTES CABRUJA"],
  cells: [ {v:"7"}, {v:"0"}, {v:"7"}, {v:"L", game:true} ] }
{ winner: true,  team: "San Diego Stingrays",
  players: ["LETIZIA MANQUILLO", "LUCIA SAINZ"],
  cells: [ {v:"6"}, {v:"6"}, {v:"10"}, {v:"W", game:true} ] }
```

Row class carries `--winner` / `--loser`. The last cell (`.cc-bcast-cell--game`) is the W/L marker, not a set. Also on the board: `.cc-bcast-duration-value` (`01:33:47`), `.cc-bcast-final-label` (`Final`), `.cc-bcast-meta` (`PPL | WOMEN'S | GROUP STAGE | · | LOS ANGELES`).

### Match statistics — `.match-h2h-board__stat-row`

Five rows, home value / label / away value:

```
43% POINTS WON 57%        46% SERVES WON 60%
40% BREAK PTS CONVERTED 54%   67% GOLDEN POINTS WON 33%
48% LONG RALLIES WON 52%
```

### The trap that costs hours

**`waitUntil: 'networkidle'` never fires on these pages.** They hold an open Firestore Listen long-poll for live updates, so there is never 500ms of network silence — the call hangs forever rather than erroring. Always `domcontentloaded` plus an explicit `waitForSelector('.match-h2h-board__set-pill')`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/lib/ppl-match-dom.ts` | **Create.** The `evaluate` body as a string-returning function plus the raw shape it produces. No Playwright import — it must be callable from a test |
| `scripts/lib/ppl-match-parse.ts` | **Create.** Pure: raw DOM JSON → typed `PplMatchResult`. All interpretation lives here |
| `scripts/__tests__/fixtures/ppl-match-la-d3-m2-womens.json` | **Create.** Captured raw DOM JSON from a real match |
| `scripts/__tests__/ppl-match-parse.test.ts` | **Create.** Parser tests against the fixture |
| `scripts/import-ppl-results.ts` | **Create.** The CLI: Playwright, per-match loop, DB writes |

Splitting DOM-reading from interpretation is what makes this testable at all — a fixture of the raw JSON can be replayed with no browser.

---

## Task 1: DOM extraction and its fixture

**Files:**
- Create: `scripts/lib/ppl-match-dom.ts`
- Create: `scripts/__tests__/fixtures/ppl-match-la-d3-m2-womens.json`

- [ ] **Step 1: Write the extraction module**

Create `scripts/lib/ppl-match-dom.ts`:

```ts
// The browser-side half of the PPL match scrape.
//
// `extractMatchDom` runs inside the page via page.evaluate(). It does no
// interpretation whatsoever — it lifts raw strings out of the DOM and hands
// them to ppl-match-parse.ts. Keeping it dumb is deliberate: everything that
// could be wrong about reading this page is then testable against a captured
// fixture, with no browser involved.
//
// Selectors verified against production on 2026-09-23. They are stable BEM
// classes, not positional guesses.

export interface RawPlayerCard {
  team: string | null
  slug: string | null
  name: string | null
  /** The card's full innerText, pipe-joined. Parsed downstream. */
  text: string | null
}

export interface RawScoreRow {
  team: string | null
  winner: boolean
  loser: boolean
  players: string[]
  /** Every cell in order. The final one is the W/L marker, flagged by `game`. */
  cells: Array<{ v: string; game: boolean }>
}

export interface RawMatchDom {
  url: string
  duration: string | null
  finalLabel: string | null
  meta: string | null
  setPills: string[]
  statRows: string[]
  scoreRows: RawScoreRow[]
  playerCards: RawPlayerCard[]
}

/**
 * Serialised and run inside the page. Must stay self-contained — it cannot
 * close over anything from this module.
 */
export function extractMatchDom(): RawMatchDom {
  const all = (s: string) => Array.from(document.querySelectorAll(s))
  const t = (el: Element | null | undefined) =>
    el ? (el as HTMLElement).innerText.replace(/\n/g, '|').trim() : null
  const one = (s: string) => document.querySelector(s)

  return {
    url: location.href,
    duration: t(one('.cc-bcast-duration-value')),
    finalLabel: t(one('.cc-bcast-final-label')),
    meta: t(one('.cc-bcast-meta')),
    setPills: all('.match-h2h-board__set-pill').map((e) => (e.textContent || '').trim()),
    statRows: all('.match-h2h-board__stat-row').map((e) => t(e) ?? ''),
    scoreRows: all('.match-detail-scoreboard .cc-bcast-row').map((r) => ({
      team: (r.querySelector('.cc-bcast-team-name')?.textContent || '').trim() || null,
      winner: r.className.includes('--winner'),
      loser: r.className.includes('--loser'),
      players: Array.from(r.querySelectorAll('.cc-bcast-player')).map((x) => (x.textContent || '').trim()),
      cells: Array.from(r.querySelectorAll('.cc-bcast-cell')).map((x) => ({
        v: (x.textContent || '').trim(),
        game: x.className.includes('--game'),
      })),
    })),
    playerCards: all('.player-spotlight__card--match-detail').map((card) => {
      const a = card.querySelector('a[href*="/player/"]')
      const href = a?.getAttribute('href') || ''
      return {
        team: (card.querySelector('.player-spotlight__team')?.textContent || '').trim() || null,
        slug: href ? href.replace(/.*\/player\/([^/]+).*/, '$1') : null,
        name: (card.querySelector('.player-spotlight__name')?.textContent || '').trim() || null,
        text: t(card),
      }
    }),
  }
}
```

**On the two `.player-spotlight__*` sub-selectors:** they are a guess. The measured card text is `TEAM | NAME | COUNTRY | VIEW PROFILE | SERVE | …`, so if `team`/`name` come back null, the parser must fall back to splitting `text` on `|` — positions 0 and 1. **Write the parser to rely on `text`, and treat `team`/`name` as a bonus.** That way a wrong guess here cannot break the phase.

- [ ] **Step 2: Capture the fixture from the production container**

Local machines in this project do not have the Playwright browser installed; the Railway container does (`/root/.cache/ms-playwright/chromium-1217`). Run there:

```bash
cd /Volumes/Crucial/dev/padel-live-scores
cat > /tmp/cap.mjs <<'SCRIPT'
(async()=>{
  const pw = await import('playwright')
  const b = await pw.chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']})
  const p = await b.newPage()
  await p.goto('https://propadelleague.com/tournament/los-angeles-2026/match/los-angeles-2026-d3-m2-womens/',
    {waitUntil:'domcontentloaded', timeout:30000})
  await p.waitForSelector('.match-h2h-board__set-pill',{timeout:30000})
  console.log('BEGIN_JSON')
  console.log(JSON.stringify(await p.evaluate(<paste the body of extractMatchDom here>), null, 1))
  await b.close(); process.exit(0)
})()
SCRIPT
B64=$(base64 -i /tmp/cap.mjs | tr -d '\n')
railway ssh --service "Padel God" "echo $B64 | base64 -d > ./cap.mjs && node ./cap.mjs; rm -f ./cap.mjs"
```

Write everything after `BEGIN_JSON` to `scripts/__tests__/fixtures/ppl-match-la-d3-m2-womens.json`.

Sanity-check before committing: 4 `playerCards` each with a non-null `slug`, 2 `scoreRows`, 3 `setPills`, 5 `statRows`. If any differs, STOP and report — the page changed.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
git add scripts/lib/ppl-match-dom.ts scripts/__tests__/fixtures/ppl-match-la-d3-m2-womens.json
git commit -m "feat(ppl): DOM extraction for match results, with a captured fixture"
```

---

## Task 2: The parser

**Files:**
- Create: `scripts/lib/ppl-match-parse.ts`
- Test: `scripts/__tests__/ppl-match-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/ppl-match-parse.test.ts`. Use the real fixture and assert the values measured on 2026-09-23 — Toronto Polar Bears (Aguilar / Montes Cabruja) lost 7-6, 0-6, 7-10 to San Diego Stingrays (Manquillo / Sainz), duration 01:33:47.

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMatchDom } from '../lib/ppl-match-parse'
import type { RawMatchDom } from '../lib/ppl-match-dom'

const RAW: RawMatchDom = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ppl-match-la-d3-m2-womens.json'), 'utf8'),
)

describe('parseMatchDom', () => {
  const r = parseMatchDom(RAW)

  it('reads both pairs with their team and a slug for every player', () => {
    expect(r.pairs).toHaveLength(2)
    for (const pair of r.pairs) {
      expect(pair.team).toBeTruthy()
      expect(pair.players).toHaveLength(2)
      for (const p of pair.players) expect(p.slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('assigns players to the pair whose team they belong to', () => {
    const sd = r.pairs.find((p) => /stingrays/i.test(p.team!))!
    expect(sd.players.map((p) => p.slug).sort()).toEqual(['letizia-manquillo', 'lucia-sainz'])
    const tor = r.pairs.find((p) => /toronto/i.test(p.team!))!
    expect(tor.players.map((p) => p.slug).sort()).toEqual(['jana-montes-cabruja', 'noemi-aguilar'])
  })

  it('marks exactly one winning pair', () => {
    expect(r.pairs.filter((p) => p.won)).toHaveLength(1)
    expect(r.pairs.find((p) => p.won)!.team).toMatch(/stingrays/i)
  })

  it('reads the sets, excluding the W/L cell', () => {
    expect(r.sets).toEqual([
      { setNumber: 1, home: 7, away: 6 },
      { setNumber: 2, home: 0, away: 6 },
      { setNumber: 3, home: 7, away: 10 },
    ])
  })

  it('reads the duration in seconds', () => {
    expect(r.durationSeconds).toBe(1 * 3600 + 33 * 60 + 47)
  })

  it('knows the match is final', () => {
    expect(r.isFinal).toBe(true)
  })

  it('reads the five match statistics as home/away percentages', () => {
    expect(r.stats).toMatchObject({
      pointsWonPct: { home: 43, away: 57 },
      servesWonPct: { home: 46, away: 60 },
      breakPointsConvertedPct: { home: 40, away: 54 },
      goldenPointsWonPct: { home: 67, away: 33 },
      longRalliesWonPct: { home: 48, away: 52 },
    })
  })

  it('reads per-player serve and shot counts', () => {
    const manquillo = r.pairs.flatMap((p) => p.players).find((p) => p.slug === 'letizia-manquillo')!
    expect(manquillo.firstServeInPct).toBe(97)
    expect(manquillo.aces).toBe(0)
    expect(manquillo.doubleFaults).toBe(0)
    expect(manquillo.winners).toMatchObject({ smash: 11, bandeja: 0, volley: 6, vibora: 1, ground: 0, lob: 0, other: 0 })
  })

  it('never invents a slug it did not find', () => {
    const stripped: RawMatchDom = { ...RAW, playerCards: RAW.playerCards.map((c) => ({ ...c, slug: null })) }
    expect(() => parseMatchDom(stripped)).toThrow(/slug/i)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

`cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league && npx vitest run scripts/__tests__/ppl-match-parse.test.ts`

- [ ] **Step 3: Implement `scripts/lib/ppl-match-parse.ts`**

Write it to satisfy the tests above. Required behaviour, stated so it is not left to taste:

- **Throw, never guess.** If a player card has no slug, if there are not exactly two score rows, or if no row is marked winner — throw with a message naming the match URL. A half-parsed result silently writing wrong lineups is the worst outcome available here.
- **Sets come from `cells` minus the trailing `game` cell.** Do not assume three sets; a two-set match has two.
- **`home` is the first score row, `away` the second.** The caller maps those onto pair1/pair2 using the tie's home/away team seasons — the parser must not care.
- **Player→pair assignment is by team name**, normalised (case, accents, punctuation) before comparison. If a card's team matches neither score row, throw.
- **Per-player numbers are parsed from the card's `text`**, pipe-split, reading the value after each label (`1ST IN`, `ACES`, `DF`, `SMASH`, `BANDEJA`, `VOLLEY`, `VIBORA`, `GROUND`, `LOB`, `OTHER`). Percentages drop the `%`.
- **`durationSeconds`** parses `HH:MM:SS`. Null when absent.
- **`isFinal`** is `finalLabel` matching `/final/i`.

- [ ] **Step 4: Run it, expect PASS (9 tests)**

- [ ] **Step 5: Mutation-check the parser**

A green suite has twice this session hidden a genuinely wrong implementation, both times because the fixture did not discriminate. Verify these three by hand — break the code, confirm the named test fails, restore:

| Mutation | Must fail |
|---|---|
| Include the trailing `game` cell as a set | the sets test |
| Assign players to pairs by card order instead of team name | the team-assignment test |
| Return `null` instead of throwing on a missing slug | the never-invents-a-slug test |

If any mutation leaves the suite green, the test is decorative — fix the test before moving on.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/ppl-match-parse.ts scripts/__tests__/ppl-match-parse.test.ts
git commit -m "feat(ppl): pure parser for scraped match results"
```

---

## Task 3: The import script — dry run only

**Files:**
- Create: `scripts/import-ppl-results.ts`

Same shape as `scripts/import-ppl-season.ts`: read `.env.local`, dry-run by default, `--apply` to write. Add `--limit N` to scrape a handful while iterating, and `--match <ppl-match-id>` for a single one.

- [ ] **Step 1: Write the script, with `--apply` throwing `not implemented`**

Structure:

1. Load the 72 PPL matches to scrape: `matches` where `tie_id is not null`, joined through `entity_external_ids` (`entity_type='match'`, `source='ppl'`) for the PPL match id, and through `tournaments.external_id` for the tournament slug. Build `https://propadelleague.com/tournament/<tournamentSlug>/match/<pplMatchId>/`.
2. Skip matches that already have all four player FKs **and** a `winner_pair`, unless `--force`. That is what makes re-runs cheap.
3. Launch one browser, reuse it, **one page at a time** — no concurrency. 72 pages at ~2.2s each is under three minutes, and a fan-out against someone else's site to save ninety seconds is not a trade worth making.
4. Per match: `goto` with `domcontentloaded`, `waitForSelector('.match-h2h-board__set-pill')` with a 30s timeout, `evaluate(extractMatchDom)`, then `parseMatchDom`.
5. Resolve each slug through `entity_external_ids` → `players.id`. Load that map once up front, not per match.
6. Map the parsed home/away pairs onto pair1/pair2 by comparing team names against the tie's `home_team_season_id` / `away_team_season_id` teams.
7. Accumulate a plan and print it. Write nothing.

Counters to print: `scraped`, `skippedAlreadyComplete`, `parseFailed`, `unresolvedSlug`, `teamMismatch`, and how many matches would get lineups, scores and stats.

**Every failure is per-match and non-fatal** — log it, count it, move on. One bad page must not abort a 72-page run.

- [ ] **Step 2: Typecheck**

`npx tsc --noEmit 2>&1 | grep "scripts/"` — expect nothing.

- [ ] **Step 3: Run the dry run against a few matches**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
npx tsx scripts/import-ppl-results.ts --limit 5
```

Expect 5 scraped, 0 failures, 5 with lineups and scores.

**This will only work where a Playwright browser exists.** If the local machine has none, either `npx playwright install chromium` once, or run the script from the Railway container. Report which you did.

- [ ] **Step 4: Full dry run over all 72, and hand the summary to the user**

```bash
npx tsx scripts/import-ppl-results.ts
```

**STOP HERE.** Do not implement `--apply` until the user has seen the summary — particularly `unresolvedSlug` and `teamMismatch`, which are the two ways this phase can attach a match to the wrong person.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-ppl-results.ts
git commit -m "feat(ppl): results scraper, dry-run only"
```

---

## Task 4: The write path

**Blocked on** the user reviewing the Task 3 dry run.

- [ ] **Step 1: Implement `--apply`**

Per match, in one pass:

**Lineups and result on `matches`:**
```ts
{
  pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
  winner_pair,                 // 1 or 2
  status: 'finished',
  duration,                    // seconds, when present
  last_updated_by: 'manual',
  updated_at: new Date().toISOString(),
}
```
Never write `matches.external_id` — the unconditional `sync_matches_id_columns` trigger copies it into `padelapi_id`, a column reserved for padelapi's numeric ids.

**Sets** — upsert on `match_id,set_number`, mirroring `fip-results-writer`:
```ts
{ match_id, set_number, set_score: `${home}-${away}`, pair1_games: home, pair2_games: away,
  is_current: false, score_source: 'api', updated_at: nowIso }
```

**Statistics** — one `match_stats` row at `set_number = 0`, `source: 'ppl'`. Map what fits existing columns; put the rest in `raw_payload`:

```ts
{ match_id, set_number: 0, source: 'ppl',
  raw_payload: { stats, players: [...per-player winners and serve numbers], scrapedAt } }
```

Per-player statistics and winners-by-shot-type have **no columns** in `match_stats` — it has no player dimension and no shot-type fields. They live in `raw_payload` until a screen consumes them. Do not add columns in this phase; the spec is explicit that a rendered stat must be queryable, and nothing renders them yet.

- [ ] **Step 2: Re-run and prove idempotency**

Run `--apply` twice. The second run must report every match as `skippedAlreadyComplete` and write nothing.

- [ ] **Step 3: Verify against the database**

Confirm by query: all 72 matches have four non-null player FKs; every match has a `winner_pair` of 1 or 2; `sets` rows exist with `score_source='api'`; no PPL match has a non-null `padelapi_id`; and — the point of the whole phase — a known player's profile query now returns PPL matches.

- [ ] **Step 4: Commit**

---

## Task 5: Verification

- [ ] `npx vitest run scripts/__tests__/` — all green
- [ ] `npx vitest run --dir src` — the same 5 pre-existing failing files as the Phase 1 baseline and nothing more. `apps/*` have no installed `node_modules` in this worktree; never read a bare root `npx vitest run` as truth
- [ ] `npx tsc --noEmit` — only the two pre-existing `push-copy.test.ts` errors
- [ ] Spot-check a player profile in the running app and confirm a PPL match renders with the `PPL` pill, and that the win rate above it did **not** move

---

## Explicitly not in this phase

- **Standings.** `team_seasons` has the columns (`ranking`, `ties_played`, `ties_won`, `points_for`, `points_against`) but filling them is a separate derivation once results exist.
- **`matches.scheduled_at`.** Still NULL. Upstream emits zone-less wall-clock in two formats within one payload; setting it needs a per-event timezone decision. The repo already has a scar from exactly this (the Paris Major 24-hour clock incident left 110 matches with a NULL `scheduled_at`).
- **The recurring worker, snapshots and retention** — Phase 2c. The spec's requirement that retention ship in the migration that creates the snapshot table still stands; there is no snapshot-cleanup precedent in the repo to copy, only `raw-payloads-prune.ts`.
- **Promoting shot-type statistics to real columns** — only once a screen reads them.
