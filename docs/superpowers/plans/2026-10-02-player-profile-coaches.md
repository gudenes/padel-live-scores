# Coaches Card on the Public Player Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a player's canonical coaches as a "Coach / Coaches" card on the Overview tab of the public player profile.

**Architecture:** A narrow owner-rights view `public.player_coaches_public` exposes only (player_id, position, coach_id, display_name, slug) for non-junk, non-merged coaches and is granted to `anon`. The profile page fetches it with the existing browser anon client and passes the rows to a small `CoachesCard` component rendered after the Current Partner card.

**Tech Stack:** Postgres (Supabase), Next.js 16 App Router client page, React 19, next-intl, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-02-player-profile-coaches-design.md`

**Ground rules**
- Work ONLY in `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/player-profile-coaches` (branch `feat/player-profile-coaches`). Never `cd` to the main repo dir. No `git stash`.
- **No production writes** (migration apply, deploy) without Gustavo's go-ahead — Task 5.
- Tests: `npx vitest run <path>` from the worktree root. Component tests need `// @vitest-environment jsdom` at the top (root `vitest.config.ts` defaults to `node`).
- `node_modules` may be missing in a fresh worktree: run `npm install` at the worktree root (a real install, not a symlink).

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002130000_player_coaches_public.sql` | public read-only view + grant |
| `scripts/verify-player-coaches-public.ts` | always-rollback check of the view's exposure |
| `src/app/[locale]/player/[id]/CoachesCard.tsx` | the card |
| `src/app/[locale]/player/[id]/__tests__/CoachesCard.test.tsx` | component tests |
| `src/app/[locale]/player/[id]/page.tsx` | fetch + render the card |
| `src/messages/{en,es,pt,it,fr}.json` | `player.coachesLabel` |

---

### Task 1: Migration — public view

**Files:**
- Create: `supabase/migrations/20261002130000_player_coaches_public.sql`
- Create: `scripts/verify-player-coaches-public.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Public, read-only projection of a player's canonical coaches for the player
-- profile (spec: docs/superpowers/specs/2026-10-02-player-profile-coaches-design.md).
--
-- Deliberately an OWNER-RIGHTS view (no security_invoker): coaches and
-- player_coaches keep RLS on with no anon policy, and this view is the only
-- anon path in. Only these five columns ever leave — notes, avatar_url,
-- country, normalized_name, aliases and both suggestion tables stay private.
-- Supabase's advisor flags owner-rights views; this one is intentional.
-- Junk and merged coaches never appear.

set local lock_timeout = '5s';

create or replace view public.player_coaches_public as
select pc.player_id, pc.position, c.id as coach_id, c.display_name, c.slug
from public.player_coaches pc
join public.coaches c on c.id = pc.coach_id
where c.status in ('unreviewed', 'verified');

revoke all on public.player_coaches_public from public;
grant select on public.player_coaches_public to anon, authenticated, service_role;

do $$
begin
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='player_coaches_public'),
    'player_coaches_public missing';
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the rollback-only verification script**

```ts
// Verifies supabase/migrations/20261002130000_player_coaches_public.sql inside a
// transaction that is ALWAYS rolled back. Nothing is committed (it briefly takes
// a lock on the coach tables). Run from the worktree root:
//   set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules npx tsx scripts/verify-player-coaches-public.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002130000_player_coaches_public.sql', 'utf8'))

    // A junk coach linked to a real player must not leak through the view.
    const player = (await c.query(`select id from players limit 1`)).rows[0].id as string
    const junk = (await c.query(
      `insert into coaches (display_name, normalized_name, slug, status) values ('Zz Junk', 'zz junk verify', 'zz-junk-verify', 'junk') returning id`,
    )).rows[0].id as string
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'Zz Junk', 9)`, [player, junk])

    await c.query('set local role anon')
    const cols = (await c.query(`select * from player_coaches_public limit 1`)).fields.map((f) => f.name).sort()
    const viewRows = (await c.query(`select count(*)::int n from player_coaches_public`)).rows[0].n as number
    const junkLeak = (await c.query(`select count(*)::int n from player_coaches_public where coach_id = $1`, [junk])).rows[0].n as number
    const coachesRows = (await c.query(`select count(*)::int n from coaches`)).rows[0].n as number
    const aliasRows = (await c.query(`select count(*)::int n from coach_aliases`)).rows[0].n as number
    const suggRows = (await c.query(`select count(*)::int n from coach_merge_suggestions`)).rows[0].n as number

    const checks = {
      exactlyFiveColumns: JSON.stringify(cols) === JSON.stringify(['coach_id', 'display_name', 'player_id', 'position', 'slug']),
      anonCanReadView: viewRows > 0,
      junkHidden: junkLeak === 0,
      coachesStillLocked: coachesRows === 0,
      aliasesStillLocked: aliasRows === 0,
      suggestionsStillLocked: suggRows === 0,
    }
    console.log({ cols, viewRows, ...checks })
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1
  } finally {
    await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Typecheck the script (no DB)**

Run: `npx tsc --noEmit --skipLibCheck --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 scripts/verify-player-coaches-public.ts`
Expected: no output. **Do not run the script** — it connects to prod (Task 5).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261002130000_player_coaches_public.sql scripts/verify-player-coaches-public.ts
git commit -m "feat(coaches): public read-only player_coaches_public view"
```

---

### Task 2: i18n label

**Files:** Modify `src/messages/{en,es,pt,it,fr}.json` — inside the top-level `"player": { … }` object (en.json: line ~675), next to `"plays"` / `"side"`.

- [ ] **Step 1: Add one ICU plural key per locale**

| File | Line to add inside `"player"` |
|---|---|
| `en.json` | `"coachesLabel": "{count, plural, one {Coach} other {Coaches}}",` |
| `es.json` | `"coachesLabel": "{count, plural, one {Entrenador} other {Entrenadores}}",` |
| `pt.json` | `"coachesLabel": "{count, plural, one {Treinador} other {Treinadores}}",` |
| `it.json` | `"coachesLabel": "{count, plural, one {Allenatore} other {Allenatori}}",` |
| `fr.json` | `"coachesLabel": "{count, plural, one {Entraîneur} other {Entraîneurs}}",` |

- [ ] **Step 2: Validate JSON and key parity**

Run:
```bash
node -e "for (const l of ['en','es','pt','it','fr']) { const m=require('./src/messages/'+l+'.json'); if(!m.player.coachesLabel) throw new Error(l+' missing'); } console.log('ok')"
```
Expected: `ok`. If the repo has an i18n parity test (`git ls-files | grep -i 'messages.*test'`), run it too.

- [ ] **Step 3: Commit**

```bash
git add src/messages
git commit -m "feat(coaches): coach label in 5 locales"
```

---

### Task 3: `CoachesCard` component (TDD)

**Files:**
- Create: `src/app/[locale]/player/[id]/CoachesCard.tsx`
- Test: `src/app/[locale]/player/[id]/__tests__/CoachesCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { CoachesCard } from '../CoachesCard'

afterEach(cleanup)

const messages = { player: { coachesLabel: '{count, plural, one {Coach} other {Coaches}}' } }
const renderCard = (coaches: { coach_id: string; display_name: string }[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CoachesCard coaches={coaches} />
    </NextIntlClientProvider>,
  )

it('renders nothing without coaches', () => {
  const { container } = renderCard([])
  expect(container.textContent).toBe('')
})

it('uses the singular label for one coach', () => {
  renderCard([{ coach_id: 'c1', display_name: 'Jorge Martinez' }])
  expect(screen.getByText('Coach')).toBeTruthy()
  expect(screen.getByText('Jorge Martinez')).toBeTruthy()
})

it('uses the plural label and keeps FIP order for two coaches', () => {
  renderCard([
    { coach_id: 'c1', display_name: 'Gustavo Pratto' },
    { coach_id: 'c2', display_name: 'Martin Canali' },
  ])
  expect(screen.getByText('Coaches')).toBeTruthy()
  const names = screen.getAllByTestId('coach-name').map((n) => n.textContent)
  expect(names).toEqual(['Gustavo Pratto', 'Martin Canali'])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/[locale]/player/[id]/__tests__/CoachesCard.test.tsx"`
Expected: FAIL — cannot resolve `../CoachesCard`.

- [ ] **Step 3: Implement**

```tsx
'use client'

// Coaches card on the player Overview tab. Names only, in FIP list order.
// Names become links once coach pages exist (spec 2026-10-02-player-profile-coaches).

import { useTranslations } from 'next-intl'
import { Widget } from './Widget'

export interface ProfileCoach {
  coach_id: string
  display_name: string
}

export function CoachesCard({ coaches }: { coaches: ProfileCoach[] }) {
  const t = useTranslations('player')
  if (coaches.length === 0) return null
  return (
    <Widget wide label={t('coachesLabel', { count: coaches.length })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {coaches.map((c) => (
          <div
            key={c.coach_id}
            data-testid="coach-name"
            style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {c.display_name}
          </div>
        ))}
      </div>
    </Widget>
  )
}
```

(Name styling matches the Current Partner name in `page.tsx`. `Widget` uppercases its label via CSS, so the DOM text stays "Coach"/"Coaches".)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/[locale]/player/[id]/__tests__/CoachesCard.test.tsx"`
Expected: PASS (3 tests). If `Widget` imports `useInViewOnce`-style hooks that need `IntersectionObserver`, add `globalThis.IntersectionObserver ??= class { observe(){} unobserve(){} disconnect(){} } as never` at the top of the test.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/player/[id]/CoachesCard.tsx" "src/app/[locale]/player/[id]/__tests__/CoachesCard.test.tsx"
git commit -m "feat(coaches): CoachesCard for the player profile"
```

---

### Task 4: Wire the card into the profile

**Files:** Modify `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: State + fetch**

Next to the `currentEquipment` state (~line 279) add:
```tsx
  const [coaches, setCoaches] = useState<ProfileCoach[]>([])
```
and import at the top with the other local imports:
```tsx
import { CoachesCard, type ProfileCoach } from './CoachesCard'
```

In `load()`, right after the equipment block (`if (!cancelled) setCurrentEquipment(...)`, ~line 345), add:
```tsx
        // Canonical coaches (public view; junk/merged excluded). Best-effort:
        // a failure must never break the profile — just no card.
        const { data: coachRows, error: coachErr } = await supabase
          .from('player_coaches_public')
          .select('coach_id, display_name, position')
          .eq('player_id', id)
          .order('position')
        if (coachErr) console.warn('[player] coaches load failed', coachErr.message)
        if (!cancelled) setCoaches((coachRows ?? []) as ProfileCoach[])
```
This sits after the amateur early-return, so amateur profiles skip it (they have no FIP coaches).

- [ ] **Step 2: Pass to Overview and render**

Add `coaches={coaches}` to the `<OverviewTab … />` call (~line 949). In `function OverviewTab({ … })` add `coaches` to the destructuring and `coaches: ProfileCoach[]` to its props type.

Right after the Current Partner block closes (`})()}` following `<Widget wide label="Current Partner">`, ~line 1164), add:
```tsx
      {/* Coaches — wide, names only (links come with coach pages) */}
      <CoachesCard coaches={coaches} />
```
Because it renders after the Current Partner expression, it naturally sits right after Road to Trophy when there is no current partner.

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit` and `npx vitest run "src/app/[locale]/player"`
Expected: no new type errors (record `npx tsc --noEmit` output before Task 4 to compare); tests pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat(coaches): show coaches on the player profile Overview"
```

---

### Task 5: Verify + rollout (each prod step needs Gustavo's go-ahead)

- [ ] **Step 1: Ask → run the rollback-only check against prod**

```bash
set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules npx tsx scripts/verify-player-coaches-public.ts
```
Expected: all six checks `true`, exit 0. (`.env.local`: copy from the main checkout, it is gitignored.)

- [ ] **Step 2: Ask → apply the migration**

```bash
set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules node -e "const{Client}=require('pg');const fs=require('fs');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(fs.readFileSync('supabase/migrations/20261002130000_player_coaches_public.sql','utf8'));console.log('applied');await c.end()})()"
```
Then confirm with the anon key that `player_coaches_public` returns rows and `coaches` returns none.

- [ ] **Step 3: Browser check (local web dev server vs prod data)**

Start the web app from this worktree (add a launch entry pointing at this worktree's `npm run dev` on a free port, as done for the admin). Verify:
- Tapia → card "COACHES": Gustavo Pratto, Martin Canali.
- A one-coach player (e.g. Alejandro Galán → Jorge Martinez) → "COACH".
- A player with no coach → no card.
- Chevaan Davids → shows his own name as coach.
- `/es/player/<id>` → "ENTRENADORES"; mobile width (375px) — no overflow.
- Console: no new errors.

- [ ] **Step 4: Ask → PR, merge, web deploy**

PR against `main`. After merge, deploy web with `./scripts/deploy.sh web` from a fresh detached checkout **outside** `.claude/` (e.g. `git worktree add --detach /Volumes/Crucial/dev/padel-deploy-web origin/main`, then `railway link --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 --environment production --service padelnachos`). Verify with `curl -s https://padelnachos.com/api/version`.
