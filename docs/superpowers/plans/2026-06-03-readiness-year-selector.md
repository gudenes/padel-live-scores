# Data Readiness Year Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Year dropdown to the Data Readiness view (populated from all in-scope years in the DB), defaulting to the current year, replacing the hardcoded 2026 window.

**Architecture:** Parameterize the readiness API with `?year=YYYY`; it also returns the distinct in-scope years (via a tiny `readiness_years()` RPC). The client adds a year `<select>`, refetches on change, falls back to the most-recent year if the current year is empty, and remounts the calendar on year change so it opens in the selected year.

**Tech Stack:** Next.js 16 / React 19 / TypeScript · Supabase (Postgres function) · Vitest. All UI token-driven.

**Spec:** `docs/superpowers/specs/2026-06-03-readiness-year-selector-design.md`

---

## File structure
- **Create:** `supabase/migrations/20260603000005_readiness_years.sql` — `readiness_years()` RPC.
- **Modify:** `apps/ops/src/app/api/internal/tournament-readiness/route.ts` — `?year=` window + return `years`.
- **Modify:** `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx` — year state, dropdown, fetch-by-year, fallback, reset selection on change, subtitle.
- **Modify:** `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx` — `initialYear` prop; open in that year.

**Commands:** lint `cd apps/ops && npx eslint <path>` · build `cd apps/ops && npm run build` · migration apply via `pg` script.

---

## Task 1: `readiness_years()` migration

**Files:** Create `supabase/migrations/20260603000005_readiness_years.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603000005_readiness_years.sql
--
-- Distinct calendar years that have in-scope (Premier + Cupra FIP) tournaments,
-- newest first. Powers the Year dropdown on the Data Readiness view. One cheap
-- indexed scan instead of pulling every tournament row into the app.

create or replace function readiness_years()
returns int[]
language sql
stable
as $$
  select coalesce(array_agg(y order by y desc), '{}')
  from (
    select distinct date_part('year', starts_at)::int as y
    from public.tournaments
    where starts_at is not null
      and level in ('major','p1','p2','finals','fip_platinum','fip_gold','fip_silver','fip_bronze')
  ) s
$$;

do $$
begin
  assert exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='readiness_years'), 'readiness_years missing';
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply + verify.** Create `apps/ops/_tmp_apply_years.mjs` (DELETE after), reading `DATABASE_URL` from the repo-root `.env.local`:

```js
import fs from 'fs'; import { Client } from 'pg';
const env = fs.readFileSync('../../../../.env.local','utf8'); // worktree apps/ops → repo root is 4 up? see note
for (const line of env.split('\n')) { const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq===-1)continue; const k=t.slice(0,eq).trim(); const v=t.slice(eq+1).trim().replace(/^["']|["']$/g,''); if(!process.env[k])process.env[k]=v; }
const sql = fs.readFileSync(process.env.MIG_PATH,'utf8');
const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
try { await c.query(sql); const r = await c.query('select readiness_years() as years'); console.log('years:', JSON.stringify(r.rows[0].years)); }
finally { await c.end(); }
```

> NOTE on the env path: this runs inside the worktree at `.claude/worktrees/year-selector/apps/ops`. The repo-root `.env.local` (with `DATABASE_URL`) is the MAIN checkout's, not present in the worktree. Resolve it robustly: read `/Volumes/Crucial/dev/padel-live-scores/.env.local` by absolute path. So set `const env = fs.readFileSync('/Volumes/Crucial/dev/padel-live-scores/.env.local','utf8')` and `MIG_PATH` to the absolute migration path. Run:

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/year-selector/apps/ops
MIG_PATH=/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/year-selector/supabase/migrations/20260603000005_readiness_years.sql node _tmp_apply_years.mjs ; rm -f _tmp_apply_years.mjs
```
(Edit the script's first line to the absolute `.env.local` path before running, per the note.)
Expected: prints `years: [2026, 2025, …]` (descending, includes 2026). If empty `[]` → STOP (the WHERE/tier list is wrong). DELETE the temp script regardless.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260603000005_readiness_years.sql
git commit -m "feat(db): readiness_years() RPC for the year dropdown"
```

---

## Task 2: Route — `?year=` window + return `years`

**Files:** Modify `apps/ops/src/app/api/internal/tournament-readiness/route.ts`

- [ ] **Step 1: Remove the module-level hardcoded constants.** Delete these two lines (currently lines 18–19):
```ts
const FROM = '2026-01-01'
const TO = '2026-12-31'
```

- [ ] **Step 2: Parse year + compute the window + fetch years.** In the `GET` handler, find:
```ts
  const idParam = new URL(request.url).searchParams.get('id')?.trim() || null
```
Replace it with:
```ts
  const url = new URL(request.url)
  const idParam = url.searchParams.get('id')?.trim() || null

  // Year window (default current year). Validated to a plausible 4-digit year.
  const yParam = Number(url.searchParams.get('year'))
  const year = Number.isInteger(yParam) && yParam >= 2000 && yParam <= 2100
    ? yParam
    : new Date().getUTCFullYear()
  const FROM = `${year}-01-01`
  const TO = `${year}-12-31`

  // Distinct in-scope years for the dropdown (skip on the single-id re-check path).
  let years: number[] = []
  if (!idParam) {
    const { data: yData, error: yErr } = await supabase.rpc('readiness_years')
    if (yErr) return NextResponse.json({ error: `years: ${yErr.message}` }, { status: 500 })
    years = (yData ?? []) as number[]
  }
```
(The existing `.or(\`and(starts_at.gte.${FROM}…\`)` line already references `FROM`/`TO`; it now picks up the local consts — no change needed there.)

- [ ] **Step 3: Include `years` in BOTH non-id returns.**
  (a) The early empty return (currently `if (ids.length === 0) return NextResponse.json({ rows: [] as ReadinessRow[] })`) → change to:
```ts
  if (ids.length === 0) return NextResponse.json(idParam ? { rows: [] as ReadinessRow[] } : { rows: [] as ReadinessRow[], years })
```
  (b) The final return (currently `return NextResponse.json({ rows })`) → change to:
```ts
  return NextResponse.json(idParam ? { rows } : { rows, years })
```

- [ ] **Step 4: Lint + verify the year window live.**
```bash
cd apps/ops && npx eslint src/app/api/internal/tournament-readiness/route.ts
```
Expected: no errors. (Live `?year=` verification happens in Task 5 against the running app; the RPC was DB-verified in Task 1.)

- [ ] **Step 5: Commit**
```bash
git add apps/ops/src/app/api/internal/tournament-readiness/route.ts
git commit -m "feat(ops): tournament-readiness ?year= window + returns available years"
```

---

## Task 3: ReadinessView — year state, dropdown, fetch, fallback

**Files:** Modify `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx`

- [ ] **Step 1: Add `year` + `years` state.** After the existing `const [verdictFilter, …]` line, add:
```ts
  const [year, setYear] = useState<number>(new Date().getUTCFullYear())
  const [years, setYears] = useState<number[]>([])
```

- [ ] **Step 2: Replace the fetch effect** (the `useEffect(() => { … fetch('/api/internal/tournament-readiness') … }, [])`) with a year-aware one:
```ts
  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/internal/tournament-readiness?year=${year}`)
      .then(r => r.json())
      .then((d: { rows?: ReadinessRow[]; years?: number[]; error?: string }) => {
        if (cancelled) return
        if (d.error) { setError(d.error); return }
        const yrs = d.years ?? []
        setYears(yrs)
        // Fallback: if the selected year has no in-scope data, jump to the most recent year that does.
        if (yrs.length > 0 && !yrs.includes(year)) { setYear(yrs[0]); return }
        setRows(d.rows ?? [])
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'failed') })
    return () => { cancelled = true }
  }, [year])
```

- [ ] **Step 3: Add a year-change handler** (resets stale selection/bulk). After `clearSel` is defined, add:
```ts
  const onYearChange = (y: number) => { setYear(y); setSelectedIds(new Set()); bulk.reset() }
```

- [ ] **Step 4: Render the Year dropdown** as the FIRST control in the filter row. Inside the filter `<div style={{ display: 'flex', gap: 18, … }}>`, before the `Tier` group `<div>`, add:
```tsx
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Year</span>
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="ui-chip"
            style={{ paddingRight: 8 }}
            aria-label="Year"
          >
            {(years.length > 0 ? years : [year]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
```

- [ ] **Step 5: Make the calendar open in the selected year.** Change the calendar render from `<ReadinessCalendar rows={filtered} />` to:
```tsx
            : <ReadinessCalendar key={year} rows={filtered} initialYear={year} />
```
(The `key={year}` remounts the calendar when the year changes so its internal month nav resets to the selected year.)

- [ ] **Step 6: Update the subtitle** (it hardcodes "2026"). Change the `PageHeader` `subtitle` string from `"2026 · main tiers. …"` to:
```tsx
        subtitle="Main tiers, by year. Each tournament is scored against status- & tier-aware expectations, measured against the public tables. Red = data the app needs is missing or was scraped-but-not-populated."
```

- [ ] **Step 7: Lint**
```bash
cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components/ReadinessView.tsx"
```
Expected: no errors. (If `react-hooks/exhaustive-deps` flags the `[year]` effect wanting more deps, it's fine as written — only `year` should drive refetch; add an eslint-disable-next-line for that effect only if it errors.)

- [ ] **Step 8: Commit**
```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx"
git commit -m "feat(ops): year dropdown + fetch-by-year on Data Readiness"
```

---

## Task 4: ReadinessCalendar — `initialYear` prop

**Files:** Modify `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx`

- [ ] **Step 1: Accept `initialYear` and open in it.** Change the signature + the year/month initial state. Current:
```tsx
export default function ReadinessCalendar({ rows }: { rows: ReadinessRow[] }) {
  const now = new Date()
  const [year, setYear] = useState(2026)
  const [month0, setMonth0] = useState(now.getUTCFullYear() === 2026 ? now.getUTCMonth() : 0)
```
Replace with:
```tsx
export default function ReadinessCalendar({ rows, initialYear }: { rows: ReadinessRow[]; initialYear: number }) {
  const now = new Date()
  const [year, setYear] = useState(initialYear)
  const [month0, setMonth0] = useState(now.getUTCFullYear() === initialYear ? now.getUTCMonth() : 0)
```
(Everything else unchanged — `setYear`/`setMonth0` still drive the ‹ › month nav, and the "Today" button still jumps to the real current month/year. Because the parent passes `key={year}`, the component remounts on year change, so these initializers re-run with the new `initialYear`.)

- [ ] **Step 2: Lint**
```bash
cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx"
```
Expected: no errors. (No other call sites of `ReadinessCalendar` exist besides ReadinessView, which Task 3 updated to pass `initialYear`.)

- [ ] **Step 3: Commit**
```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx"
git commit -m "feat(ops): readiness calendar opens in the selected year"
```

---

## Task 5: Verify

**Files:** none.

- [ ] **Step 1: Lint the whole feature dir + route**
```bash
cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components" src/app/api/internal/tournament-readiness/route.ts
```
Expected: no errors.

- [ ] **Step 2: tsc on our files**
```bash
cd apps/ops && npx tsc --noEmit 2>&1 | grep -iE "data-readiness|tournament-readiness"
```
Expected: NO output (ignore unrelated recharts/bcryptjs noise if the worktree node_modules is incomplete).

- [ ] **Step 3: Build (authoritative gate is Vercel CI on the PR; attempt locally if the worktree env allows)**
```bash
cd apps/ops && npm run build 2>&1 | tail -5
```
If the worktree build fails on Turbopack workspace-root inference or missing deps, that's environmental — note it; Vercel CI validates the build on the PR.

- [ ] **Step 4: Manual (controller, running app, operator)**
  - Year dropdown appears first in the filter row, lists all in-scope years (desc), defaults to the current year.
  - Switching to a past year (e.g. 2025) reloads KPIs + list (all Completed) + calendar; calendar opens in that year and ‹ › pages within it.
  - If the current year has no data, the page auto-lands on the most recent year (no empty screen).
  - Single + bulk refresh still work; switching year clears any prior selection.

- [ ] **Step 5: Final commit (if fixups needed)**
```bash
git add -A && git commit -m "chore(ops): year-selector verification fixups"
```

---

## Self-review notes (author)
- **Spec coverage:** `?year=` window + `readiness_years()` RPC + `{rows, years}` (Tasks 1–2), dropdown + default current-year + most-recent fallback + reset-selection-on-change (Task 3), calendar opens in selected year via `key`+`initialYear` (Tasks 3–4), `?id=` path returns `{rows}` only and is unchanged (Task 2 Step 3), single-select / no "All years" (dropdown of discrete years). Covered.
- **Type consistency:** route returns `{ rows, years? }`; the view's fetch typed `{ rows?; years?; error? }`; `ReadinessCalendar` prop `initialYear: number` matches the `initialYear={year}` passed by the view.
- **No double-fetch loop:** the fallback sets `year` to a value guaranteed to be in `years`, so the subsequent fetch returns that year in `years` and the `!includes` branch doesn't re-fire.
- **`?id=` safety:** years query + window are skipped when `idParam` is set; the id branch still returns `{ rows }`, so bulk/single refresh re-check is byte-compatible.
