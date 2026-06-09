# Console Rules + Per-row Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-category firing rules + a one-click per-row "Test to me" button to the ops Notifications console.

**Architecture:** A new `CATEGORY_RULES` map (main app, `src/lib/notification-catalog.ts`) holds each category's human rule + sample copy; `buildCatalog` merges `description` + `sample` onto every `CatalogRow`; the existing catalog endpoint returns them unchanged; the ops console renders the rule as a muted line under each category and a per-row Test button that POSTs the sample to the operator-only `notify-test` proxy.

**Tech Stack:** TypeScript, Next.js (main + `apps/ops`), Vitest. Two packages — `npm install` in each (already installed in this worktree if prepped).

**Spec:** `docs/superpowers/specs/2026-06-09-console-rules-and-row-test-design.md`

---

## File Structure
**Modify (main):** `src/lib/notification-catalog.ts` (add `CategoryRule`, `CATEGORY_RULES`, extend `CatalogRow` + `buildCatalog`); `src/lib/__tests__/notification-catalog.test.ts` (coverage test). The endpoint `src/app/api/internal/notification-catalog/route.ts` needs **no change** (returns `buildCatalog` output).
**Modify (ops):** `apps/ops/src/lib/notification-catalog-types.ts` (`CatalogRow` += `description`, `sample`); `apps/ops/src/app/(app)/system/notifications/_components/NotificationsConsole.tsx` (rule line + Actions column + per-row Test); `_components/console.module.css` (rule-line style if needed).

---

## Task 1: `CATEGORY_RULES` + `buildCatalog` extension (main)

**Files:** Modify `src/lib/notification-catalog.ts` + `src/lib/__tests__/notification-catalog.test.ts`

- [ ] **Step 1: Add the failing test** (append to `notification-catalog.test.ts`):
```ts
import { CATEGORY_RULES } from '@/lib/notification-catalog'
import { KNOWN_CATEGORIES } from '@/lib/notification-categories'

describe('CATEGORY_RULES', () => {
  it('every known category has a non-empty rule + sample', () => {
    for (const key of KNOWN_CATEGORIES) {
      const r = CATEGORY_RULES[key]
      expect(r, key).toBeDefined()
      expect(r.rule.length, key).toBeGreaterThan(10)
      expect(r.sampleTitle.length, key).toBeGreaterThan(0)
      expect(r.sampleBody.length, key).toBeGreaterThan(0)
    }
  })
  it('buildCatalog carries description + sample', () => {
    const rows = buildCatalog([], Date.parse('2026-06-09T12:00:00Z'))
    const row = rows.find(r => r.key === 'tournament_starting')!
    expect(row.description).toBe(CATEGORY_RULES.tournament_starting.rule)
    expect(row.sample).toEqual({ title: CATEGORY_RULES.tournament_starting.sampleTitle, body: CATEGORY_RULES.tournament_starting.sampleBody })
  })
})
```
(Ensure `buildCatalog` is already imported at the top of the test file — it is.)

- [ ] **Step 2: Run → fail** (`npx vitest run src/lib/__tests__/notification-catalog.test.ts`).

- [ ] **Step 3: Implement.** Add to `src/lib/notification-catalog.ts`:
```ts
export type CategoryRule = { rule: string; sampleTitle: string; sampleBody: string }

// Operator-facing documentation: how each category fires + a representative
// sample for the per-row "Test to me". Keep rules accurate to the sender logic.
export const CATEGORY_RULES: Record<NotificationCategory, CategoryRule> = {
  match_live_follow:    { rule: "When a followed player's match goes live (scheduled → live). → that player's followers. Live now.", sampleTitle: 'Tapia is on court! 🟢', sampleBody: 'Tapia/Coello vs Galán/Chingotto — Madrid P1, QF.' },
  match_live_bookmark:  { rule: 'When a bookmarked match goes live. → users who bookmarked the match. Live now.', sampleTitle: 'Match is live! 🟢', sampleBody: 'A match you saved just started — Madrid P1, QF.' },
  match_finished:       { rule: 'When a followed/bookmarked match finishes. → match followers + bookmarkers. Live now.', sampleTitle: 'Match finished 🏆', sampleBody: 'Tapia/Coello beat Galán/Chingotto 6-4 3-6 6-2.' },
  match_scheduled:      { rule: 'Once, when a followed match first gets a firm time + court. → match followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-oop-writer).', sampleTitle: 'Madrid P1: match scheduled', sampleBody: 'A match you follow now has a time and court.' },
  match_deciding_set:   { rule: 'When a followed Premier match reaches a deciding 3rd set. → match followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Going the distance!', sampleBody: 'Tapia/Coello forced a deciding 3rd set — 6-4 3-6.' },
  match_upset_live:     { rule: 'When an underdog leads a followed Premier match live. → match followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Upset in progress', sampleBody: 'An underdog is leading a match you follow.' },
  next_match_drawn:     { rule: "When a followed player's next-round opponent is set after a win. → that player's followers. Pro · no sender yet (Plan 3).", sampleTitle: 'Next match drawn', sampleBody: "Tapia's next: QF vs Stupaczuk/Di Nenno." },
  player_title_won:     { rule: 'When a followed player wins a final. → that player\'s followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-results-writer).', sampleTitle: 'Champion! 🏆', sampleBody: 'Your player just won the title.' },
  player_eliminated:    { rule: 'When a followed player loses (any non-final finish). → that player\'s followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-results-writer).', sampleTitle: 'Knocked out', sampleBody: 'Your player was eliminated.' },
  ranking_updated:      { rule: 'Weekly, when FIP rankings refresh and a followed player moves. → that player\'s followers. No automated sender wired yet.', sampleTitle: 'Rankings updated', sampleBody: 'Your players moved in this week\'s rankings.' },
  ranking_threshold:    { rule: 'When a followed player crosses #1 / top 10 / top 20. → that player\'s followers. Pro · no sender yet (Plan 3).', sampleTitle: 'Ranking milestone', sampleBody: 'Ariana Sánchez is back to World No. 1.' },
  projection_outperform:{ rule: 'When a followed pair advances past their projected finish (Road to Trophy). → followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Beating the bracket', sampleBody: 'Your pick went further than the model expected!' },
  tournament_starting:  { rule: "Once, when a followed tournament's start time passes (within a 24h window). → tournament followers. Gated by ENABLE_TOURNAMENT_START_NOTIFIER (padelgod tournament-start-notifier).", sampleTitle: 'Madrid P1 is underway', sampleBody: 'Play has started — follow the action and order of play.' },
  draw_released:        { rule: 'Once per tournament + category, when its bracket first appears. → tournament followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-draw-populator).', sampleTitle: 'Draw is out', sampleBody: 'The bracket for an event you follow has been published.' },
  player_entered:       { rule: 'Once per tournament + player, when a followed player first appears in an entry list. → that player\'s followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-entry-list-populator).', sampleTitle: 'New tournament entry', sampleBody: 'A player you follow just entered an event.' },
  player_path:          { rule: "A followed player's draw position + next opponent. → that player's followers. Pro · no sender yet (Plan 3).", sampleTitle: "Tapia's path", sampleBody: 'Round of 16 · next: winner of Stupa/Di Nenno.' },
  prematch_prediction:  { rule: 'Model win-probability before a followed match. → match/player followers. Pro · no sender yet (Plan 3).', sampleTitle: 'Pre-match: Tapia/Coello 68%', sampleBody: 'Our model favours them in today\'s QF.' },
  daily_oop:            { rule: "Morning briefing of your players' matches today. → followers. Pro · no sender yet (Plan 4 digest).", sampleTitle: 'Your players today (3)', sampleBody: 'Tapia 18:00 · Galán 19:30 · Sánchez 16:00.' },
  weekly_digest:        { rule: "Weekly recap: your players' week + weekend champions + the week ahead. → opted-in followers. No sender yet (Plan 4 batch job).", sampleTitle: 'Your week in padel', sampleBody: 'Weekend champions + how your players did + what\'s next.' },
  tournament_wrapup:    { rule: 'Recap when a followed tournament ends: champions + notable results. → tournament followers. Pro · no sender yet (Plan 4 digest).', sampleTitle: 'Madrid P1 wrap-up', sampleBody: 'Champions crowned + the weekend\'s standout results.' },
  marketing:            { rule: 'Manual product announcements. → opted-in users (opt-out model). Sent ad-hoc; no scheduled sender.', sampleTitle: 'New in PadelNachos', sampleBody: 'Check out the latest update.' },
}
```
Extend `CatalogRow` (add two fields) and `buildCatalog` (populate them from `CATEGORY_RULES[key]`):
```ts
export type CatalogRow = {
  key: NotificationCategory
  tier: 'free' | 'pro'
  group: string
  comingSoon: boolean
  status: CategoryStatus
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
  description: string
  sample: { title: string; body: string }
}
```
In the `buildCatalog` return object, add:
```ts
      description: CATEGORY_RULES[key].rule,
      sample: { title: CATEGORY_RULES[key].sampleTitle, body: CATEGORY_RULES[key].sampleBody },
```

- [ ] **Step 4: Run → pass** (`npx vitest run src/lib/__tests__/notification-catalog.test.ts`). Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/notification-catalog.ts src/lib/__tests__/notification-catalog.test.ts
git commit -m "feat(lib): per-category notification rules + sample copy on the catalog"
```
(Co-Authored-By trailer.)

---

## Task 2: Ops types + UI (rule line + per-row Test)

**Files:** Modify `apps/ops/src/lib/notification-catalog-types.ts`, `_components/NotificationsConsole.tsx`, `_components/console.module.css`

- [ ] **Step 1: Extend the ops type** in `notification-catalog-types.ts`:
```ts
export type CatalogRow = {
  key: string; tier: 'free' | 'pro'; group: string; comingSoon: boolean
  status: CategoryStatus; lastFiredAt: string | null
  count7d: number; recipients7d: number; failed7d: number
  description: string
  sample: { title: string; body: string }
}
```

- [ ] **Step 2: Add per-row test state + handler** in `NotificationsConsole.tsx` (near the other `useState`s):
```ts
const [rowTest, setRowTest] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'err'>>({})

async function onRowTest(row: CatalogRow) {
  if (rowTest[row.key] === 'testing') return
  setRowTest((s) => ({ ...s, [row.key]: 'testing' }))
  try {
    const r = await fetch('/api/internal/notify-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: row.sample.title, body: row.sample.body, url: '/' }),
    })
    setRowTest((s) => ({ ...s, [row.key]: r.ok ? 'ok' : 'err' }))
  } catch {
    setRowTest((s) => ({ ...s, [row.key]: 'err' }))
  }
}
```

- [ ] **Step 3: Render the rule line under the category name.** Replace the category cell (`<td>{row.key}</td>`, ~line 202) with:
```tsx
<td>
  <div className={styles.catName}>{row.key}</div>
  <div className={styles.catRule}>{row.description}</div>
</td>
```

- [ ] **Step 4: Add the Actions column.** In the table header row (where `7D FAILED` / the `<th>`s are), append a trailing `<th>Test</th>`. In each body row (after the `failed7d` cell ~line 208) append:
```tsx
<td>
  <Button variant="ghost" onClick={() => onRowTest(row)} disabled={rowTest[row.key] === 'testing'}>
    {rowTest[row.key] === 'testing' ? 'Testing…' : rowTest[row.key] === 'ok' ? '✓ Sent' : rowTest[row.key] === 'err' ? '✗ Retry' : 'Test'}
  </Button>
</td>
```
(Match the existing header/column structure — find the actual `<thead>`/`<th>` markup; the grep showed columns CATEGORY/TIER/STATUS/LAST FIRED/7D FIRES/7D RECIPIENTS/7D FAILED. Add one more `<th>` + `<td>`.)

- [ ] **Step 5: Add CSS** to `console.module.css`:
```css
.catName { font-weight: 600; }
.catRule { margin-top: 3px; font-size: 11.5px; line-height: 1.4; color: var(--text-3); max-width: 520px; }
```

- [ ] **Step 6: Verify** — `cd apps/ops && npx tsc --noEmit` clean; `npm run build` compiles. Lint the changed files.

- [ ] **Step 7: Commit**
```bash
git add apps/ops/src/lib/notification-catalog-types.ts "apps/ops/src/app/(app)/system/notifications/_components/NotificationsConsole.tsx" "apps/ops/src/app/(app)/system/notifications/_components/console.module.css"
git commit -m "feat(ops): per-category rule lines + one-click per-row Test on the console"
```
(Co-Authored-By trailer.)

---

## Task 3: Verify + PR

- [ ] **Step 1: Tests** — `npx vitest run src/lib/__tests__/notification-catalog.test.ts` → pass.
- [ ] **Step 2: Builds** — main `npm run build`; `cd apps/ops && npm run build` → clean. tsc both.
- [ ] **Step 3: Lint** touched files → clean.
- [ ] **Step 4: e2e (controller)** — catalog endpoint returns `description` + `sample` per row (curl with CRON_SECRET); a per-row Test (via the live console, flag already on) sends a push to the operator + shows ✓. (Backend: confirm `notify-test` → test-push delivers; no `notification_sends` row written.)
- [ ] **Step 5: Push + PR**
```bash
git push -u origin feat/console-rules-and-row-test
gh pr create --base main --title "Notifications console: per-category rules + per-row Test" --body "<summary + test plan>"
```

---

## Self-Review (coverage vs spec)
- **Per-category rules** (source of truth + endpoint + UI line) → Task 1 (`CATEGORY_RULES` + `buildCatalog`) + Task 2 (types + rule line). ✓
- **Per-row one-click Test (operator-only)** → Task 2 (Actions column + `onRowTest` → `notify-test`). ✓
- **All categories documented** → Task 1 authors all 21 + a coverage test that fails if any is missing. ✓
- **No new tables/senders; endpoint unchanged** → confirmed (buildCatalog passthrough). ✓
- **Safety (operator-only, no analytics row)** → reuses `notify-test` (→ test-push to operator). ✓

## Open questions for the implementer
- Confirm the exact `<thead>` markup in `NotificationsConsole.tsx` to append the `Test` `<th>` consistently (the grep showed a `<DataTable>` with manual `<tr>/<td>`; match its header row).
- If `Button` doesn't support a compact/inline size, the ghost variant is fine; keep it small so the Actions column doesn't bloat row height.
