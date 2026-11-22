# Live Race: development and deployment

Run from `/Volumes/Crucial/dev/padel-live-race-mvp` using Node 26:

```sh
npm run dev -- --webpack --hostname 127.0.0.1 --port 3000
```

In a second terminal:

```sh
npm run race:watch
```

Open http://localhost:3000/rankings?type=race. The former `racePreview=1` parameter no longer selects fixtures. Both genders show every public player in the source snapshot (currently 1,000 each), with search across the full list. Coaches and other ranking tabs remain available.

## Sources and reconciliation

The worker reads official Race snapshots, tournaments and completed matches from the existing Supabase source. It validates each affected player's counting and non-counting results against their dated FIP profile before projecting the best 22 results under the 2026 points rules. Round awards are tournament totals, not cumulative points per win.

The existing PadelGod importer checks FIP on Mondays every 30 minutes from 06:00–12:30 UTC, with Tuesday–Saturday recovery at 07:00 UTC. The local worker checks the imported publication after each refresh cycle (60-second pause), adopts new official points/ranks, and recalculates remaining provisional results. It also detects corrections to the same publication. Reconciliation records are saved locally. The Race worker does not schedule or change the existing FIP importer.

For local development, keep the computer awake, dev server and watcher running for automatic updates. After downtime, restarting catches up with the latest available publication. The UI polls its local API every 30 seconds while visible. If the importer is delayed, the old baseline stays labeled by date; it is never presented as a new Monday publication.

## Verification and limitations

Missing or mismatched histories, mandatory zero results, ambiguous qualifying draws, conflicting match rows and overlapping tournaments remain marked as awaiting verification. Those players retain official points until safely calculable or reconciled by FIP. Partial rankings are explicitly provisional. Failed refreshes and snapshots older than five minutes are marked stale. The 2026 points schedule is deliberately not reused for 2027.

The list contains all available published source rows, not a claim that the upstream importer includes every FIP player worldwide. Players absent from the source snapshot are not invented or appended from match feeds.

All remote database operations are reads. Files, profile caches, locks and reconciliation logs live in ignored `.local/race/`; credentials must remain there or in local environment files. Production runs its own watcher alongside the web process when LIVE_RACE_ENABLED=true. Its per-instance caches rebuild from official data after replacement; they are not the official source. The web API serves the computed snapshots in production too.

Stop the watcher with Ctrl-C. `npm run race:refresh` runs one cycle when no watcher is active. After an unclean exit, confirm no watcher or refresh is running before removing the `.local/race/watcher.lock`, `men.lock` or `women.lock` directories.

## Checks

```sh
npx vitest run src/lib/live-race/engine.test.ts src/lib/__tests__/race-display.test.ts src/components/rankings/RaceStandings.test.tsx
npx tsc --noEmit
```

Tests cover net best-22 gains, corrections, Monday rebasing without double counting, incomplete histories, qualification/seed bonuses, duplicate results, full-list rendering, cutoff ties and stale labels.

## Match points badge

Daily match cards show the base tournament total secured by winning the displayed main-draw round. The clickable badge sits beside the round badge in the existing metadata row. The row stays on one line and scrolls horizontally on narrow cards, without adding a new row. The explanation opens in a viewport-clamped portal and closes on outside tap or Escape. It distinguishes tournament totals from net best-22 Race gains and excludes individual bonuses. Unsupported levels, qualifying rounds and non-2026 dates have no badge.

The points popover now illustrates both pairs: the winner’s secured tournament total and the loser’s exit total, per player. Both use the same tier/round table. It explains that bonuses and withdrawals can differ and that Race gains depend on the best 22 results.

### Qualifying badges

`/api/rankings/match-points?tournament=<uuid>` reads the complete tournament draw, separately for men and women, with pagination. It validates qualifying match counts against the 2026 bracket formats before assigning round-specific points. Day-filtered lists must never establish the last qualifying round. Missing, conflicting or nonstandard brackets remain unpriced and retry every minute.

Qualifying-final winner totals include the first main-draw result plus the qualification bonus; earlier winners secure the next qualifying round's exit points. Zero-point early exits remain zero. The popover prominently labels the minimum secured **with a win**, explains the included bonus, and notes withdrawal/lucky-loser exceptions. This is a match-stakes display; it does not replace the Race engine's separate player-history validation.

Verified sources (22 November 2026):
- Men's 2026 rulebook, sections 4.2.1 and 7.1.4–7.2.2: https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Mens_EN-2-1.pdf
- Women's 2026 rulebook, same sections: https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Women%C2%B4s_EN-2-1.pdf
- CUPRA FIP Tour 2026 rulebook: https://www.padelfip.com/wp-content/uploads/2025/03/Cupra-FIP-Tour-Rulebook_EN-1-1-2.pdf

Examples: Mexico Major men's Q2 win secures 30 points, loss 15; men's Q3 and women's Q2 are qualifying finals, offering 50 minimum (35 main draw + 15 bonus) versus 30 on exit, assuming normal completion.

Qualifying badge wording is explicit: `Win: 15 pts` describes advancing from men’s Major Q1 to Q2. The popover separately displays `Exit in this round: 0 pts per player`. Men’s Major exit totals remain Q1=0, Q2=15 and last qualifying=30; they are not cumulative.


## Production process

The approved web start script launches Next.js and, with `LIVE_RACE_ENABLED=true`, the Race watcher using Node's TypeScript stripping (Node 22.18+). The auxiliary process restarts after a crash and recovers abandoned locks. The worker uses the web service's existing Supabase read credentials and FIP proxy configuration. The 50 MB profile-fetch budget resets daily in UTC. Profile fetches are capped at 24 per gender per cycle; unverified players keep official totals while caches warm. Each web instance owns its own cache; deleting it is safe because a new official baseline and projections are rebuilt. No local cache or proxy credential file is included in the upload.
