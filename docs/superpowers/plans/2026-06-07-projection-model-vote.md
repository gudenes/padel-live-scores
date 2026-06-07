# Projection model-vote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plain-language projection ("Projected to reach the Quarterfinals") to each pair's road, plus a 👍/👎 vote whose reveal is a **global** "fans agree with our model" signal — shipped as a flag-gated experiment.

**Architecture:** Prediction is derived client-side from the road VM's per-round reach probabilities (no backend). Votes go through a server route (`/api/projection-vote`) mirroring `/api/match-rating`: a `projection_votes` table keyed by `voter_id` (device UUID `pn_device_id`, or account id when logged in), with a global agree/disagree head-count tally revealed after the user has voted. A `useProjectionVote` hook (mirrors `useMatchRating`) drives the card. The vote UI is gated by a new DB feature flag `projection_vote_enabled`.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client hooks, Supabase (service client for writes, public-read flags), next-intl, vitest. Migrations applied via the `pg` driver + `DATABASE_URL` (NOT `supabase db push`).

**Spec:** `docs/superpowers/specs/2026-06-07-projection-model-vote-design.md`
**Branch:** `feat/projection-picker` (continued polish; currently ahead of `main`).

---

## Key current-state facts (verified)

- `ProjectionTab.tsx` is a client component. The road view computes `vm = buildRoadVM(...)` with `vm.status` (`'active'|'eliminated'|'champion'`) and `vm.rounds: RoadRoundVM[]` where each round has `{ round: ProjRound, reachProb: number, expected, opponents }`. The hero (champion %) sits above a `{t('projectedPath')}` label, then the rounds.
- `selectedPair: string | null`, `category: 'men'|'women'`, `tournamentId: string` are all in scope before the component's early returns.
- `ROUND_LABEL_KEY: Record<ProjRound,string>` (`'R64'→'roundR64'`, …, `'F'→'roundF'`) is exported from `src/lib/projection-view.ts`; the i18n values are display names (used by `t('reachedRound', { round })`).
- Feature flags: `FLAG_KEYS` in `src/lib/feature-flags.ts`; `useFeatureFlag(key)` in `src/hooks/useFeatureFlag.ts`; seed via migration like `20260606150000_projection_feature_flag.sql`.
- Vote/device pattern to mirror: `src/app/api/match-rating/route.ts` (service client + `auth()` for userId) and `src/hooks/useMatchRating.ts` (localStorage `pn_device_id`, optimistic local write + POST).
- `createServerClient` (service-role) and `auth()` are imported as in `match-rating/route.ts`.

---

## Task 1: `projection_votes` table

**Files:**
- Create: `supabase/migrations/20260607100000_projection_votes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260607100000_projection_votes.sql
-- Fan agree/disagree votes on a pair's projected finish. Pair context is kept
-- for analysis, but only the GLOBAL agree/disagree tally is surfaced
-- ("agreement with our model"). One changeable vote per (pair, voter).
create table if not exists public.projection_votes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men','women')),
  pair_key text not null,
  voter_id text not null,                 -- device UUID (pn_device_id) or account id when logged in
  vote text not null check (vote in ('agree','disagree')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, category, pair_key, voter_id)
);
create index if not exists projection_votes_vote_idx on public.projection_votes (vote);
create index if not exists projection_votes_voter_idx on public.projection_votes (voter_id);

-- RLS on, no policies → anon/auth clients get nothing; all access is via the
-- server route using the service-role key (which bypasses RLS).
alter table public.projection_votes enable row level security;
```

- [ ] **Step 2: Apply to the DB**

Run (from the worktree root; reads `DATABASE_URL` from `.env.local`):
```bash
node -e '
const fs=require("fs");const u=(fs.readFileSync(".env.local","utf8").match(/DATABASE_URL=(.*)/)||[])[1].trim().replace(/^["\x27]|["\x27]$/g,"");
const{Client}=require("pg");const c=new Client({connectionString:u});
(async()=>{await c.connect();await c.query(fs.readFileSync("supabase/migrations/20260607100000_projection_votes.sql","utf8"));console.log("applied");await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})
'
```
Expected: `applied`.

- [ ] **Step 3: Verify**

```bash
node -e '
const fs=require("fs");const u=(fs.readFileSync(".env.local","utf8").match(/DATABASE_URL=(.*)/)||[])[1].trim().replace(/^["\x27]|["\x27]$/g,"");
const{Client}=require("pg");const c=new Client({connectionString:u});
(async()=>{await c.connect();const r=await c.query("select count(*) from public.projection_votes");console.log("rows",r.rows[0].count);await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})
'
```
Expected: `rows 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607100000_projection_votes.sql
git commit -m "feat(projection-vote): projection_votes table"
```

---

## Task 2: `projection_vote_enabled` feature flag

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Create: `supabase/migrations/20260607100100_projection_vote_flag.sql`

- [ ] **Step 1: Add the key**

In `src/lib/feature-flags.ts`, add to `FLAG_KEYS` (after `PROJECTION_ENABLED`):
```ts
  PROJECTION_ENABLED:             'projection_enabled',
  PROJECTION_VOTE_ENABLED:        'projection_vote_enabled',
```

- [ ] **Step 2: Write the flag migration**

```sql
-- supabase/migrations/20260607100100_projection_vote_flag.sql
-- DB flag for the Projection model-agreement vote EXPERIMENT (👍/👎 under the
-- road's prediction). Independent of projection_enabled so the experiment can
-- be toggled on its own. OFF in prod, ON local for polish.
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'projection_vote_enabled',
  'Projection · Model-agreement vote',
  false,
  true,
  'Experiment: 👍/👎 on a pair''s projected finish; reveals a global "fans agree with our model" tally. OFF in prod.'
)
on conflict (key) do nothing;
```

- [ ] **Step 3: Apply + verify**

```bash
node -e '
const fs=require("fs");const u=(fs.readFileSync(".env.local","utf8").match(/DATABASE_URL=(.*)/)||[])[1].trim().replace(/^["\x27]|["\x27]$/g,"");
const{Client}=require("pg");const c=new Client({connectionString:u});
(async()=>{await c.connect();await c.query(fs.readFileSync("supabase/migrations/20260607100100_projection_vote_flag.sql","utf8"));const r=await c.query("select key,enabled,enabled_local from public.feature_flags where key=\x27projection_vote_enabled\x27");console.log(JSON.stringify(r.rows[0]));await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})
'
```
Expected: `{"key":"projection_vote_enabled","enabled":false,"enabled_local":true}`.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep feature-flags || echo CLEAN
git add src/lib/feature-flags.ts supabase/migrations/20260607100100_projection_vote_flag.sql
git commit -m "feat(projection-vote): projection_vote_enabled flag (prod off, local on)"
```

---

## Task 3: `projectedFinishRound` helper

**Files:**
- Modify: `src/lib/projection-view.ts`
- Test: `src/lib/__tests__/projection-finish.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/projection-finish.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { projectedFinishRound, type RoadRoundVM } from '@/lib/projection-view'

const rd = (round: RoadRoundVM['round'], reachProb: number): RoadRoundVM =>
  ({ round, dateIso: null, reachProb, expected: null, opponents: [] })

describe('projectedFinishRound', () => {
  it('returns the deepest round with reach >= 0.5', () => {
    expect(projectedFinishRound([rd('R64', 1), rd('R32', 1), rd('R16', 0.86), rd('QF', 0.55), rd('SF', 0.3), rd('F', 0.12)])).toBe('QF')
  })
  it('returns the Final for a strong favourite', () => {
    expect(projectedFinishRound([rd('R32', 1), rd('R16', 0.9), rd('QF', 0.8), rd('SF', 0.7), rd('F', 0.55)])).toBe('F')
  })
  it('falls back to the entry round when no later round is favoured', () => {
    expect(projectedFinishRound([rd('R32', 1), rd('R16', 0.2)])).toBe('R32')
  })
  it('returns null for empty rounds', () => {
    expect(projectedFinishRound([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run src/lib/__tests__/projection-finish.test.ts`
Expected: FAIL — `projectedFinishRound` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/projection-view.ts`:
```ts
/** The pair's projected finish: the DEEPEST round they're more likely than not
 *  to reach (reachProb ≥ 0.5). Falls back to the shallowest round present when
 *  none is favoured; null for an empty list. Used for the road's plain-language
 *  prediction ("Projected to reach the {round}"). */
export function projectedFinishRound(rounds: RoadRoundVM[]): ProjRound | null {
  if (rounds.length === 0) return null
  let deepest = rounds[0]!.round
  for (const r of rounds) {
    if (r.reachProb >= 0.5) deepest = r.round
  }
  return deepest
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npx vitest run src/lib/__tests__/projection-finish.test.ts` → 4 passed.
`npx tsc --noEmit 2>&1 | grep projection-view || echo CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection-view.ts src/lib/__tests__/projection-finish.test.ts
git commit -m "feat(projection-vote): projectedFinishRound helper (deepest >=50% round)"
```

---

## Task 4: `/api/projection-vote` route

**Files:**
- Create: `src/app/api/projection-vote/route.ts`

- [ ] **Step 1: Implement** (mirrors `match-rating/route.ts`)

```ts
// src/app/api/projection-vote/route.ts
// Agree/disagree votes on a pair's projected finish. Stores pair context but
// surfaces a GLOBAL agree/disagree tally. Reveal-after-vote is enforced here:
// the global tally is only returned once the voter has cast any vote.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

type Vote = 'agree' | 'disagree'

async function globalTally(supabase: SupabaseClient): Promise<{ agree: number; disagree: number }> {
  const [a, d] = await Promise.all([
    supabase.from('projection_votes').select('*', { count: 'exact', head: true }).eq('vote', 'agree'),
    supabase.from('projection_votes').select('*', { count: 'exact', head: true }).eq('vote', 'disagree'),
  ])
  return { agree: a.count ?? 0, disagree: d.count ?? 0 }
}

async function resolveVoterId(bodyOrParamDeviceId: string | null): Promise<string | null> {
  const session = await auth().catch(() => null)
  if (session?.user?.id) return session.user.id
  return bodyOrParamDeviceId || null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tournamentId = sp.get('tournamentId')
  const category = sp.get('category')
  const pairKey = sp.get('pairKey')
  const voterId = await resolveVoterId(sp.get('deviceId'))
  if (!tournamentId || !category || !pairKey || !voterId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }
  const supabase = createServerClient()

  const { data: mine } = await supabase
    .from('projection_votes')
    .select('vote')
    .eq('tournament_id', tournamentId).eq('category', category).eq('pair_key', pairKey).eq('voter_id', voterId)
    .maybeSingle()

  const { count: everCount } = await supabase
    .from('projection_votes').select('*', { count: 'exact', head: true }).eq('voter_id', voterId)
  const hasVotedEver = (everCount ?? 0) > 0

  return NextResponse.json({
    yourVote: (mine?.vote as Vote | undefined) ?? null,
    hasVotedEver,
    global: hasVotedEver ? await globalTally(supabase) : null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const tournamentId: string | undefined = body?.tournamentId
  const category: string | undefined = body?.category
  const pairKey: string | undefined = body?.pairKey
  const vote: string | undefined = body?.vote
  if (!tournamentId || !category || (category !== 'men' && category !== 'women') || !pairKey || (vote !== 'agree' && vote !== 'disagree')) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const voterId = await resolveVoterId(body?.deviceId ?? null)
  if (!voterId) return NextResponse.json({ error: 'Must provide deviceId or auth' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase.from('projection_votes').upsert(
    { tournament_id: tournamentId, category, pair_key: pairKey, voter_id: voterId, vote, updated_at: new Date().toISOString() },
    { onConflict: 'tournament_id,category,pair_key,voter_id' },
  )
  if (error) {
    console.error('[projection-vote] upsert error:', error)
    return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
  }
  return NextResponse.json({ yourVote: vote, global: await globalTally(supabase) })
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep projection-vote || echo CLEAN
git add "src/app/api/projection-vote/route.ts"
git commit -m "feat(projection-vote): /api/projection-vote (GET state + POST upsert, global tally)"
```

---

## Task 5: `useProjectionVote` hook

**Files:**
- Create: `src/hooks/useProjectionVote.ts`

- [ ] **Step 1: Implement** (mirrors `useMatchRating`; shares the `pn_device_id` key)

```ts
'use client'
import { useState, useCallback, useEffect } from 'react'

const DEVICE_ID_KEY = 'pn_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id) }
    return id
  } catch { return crypto.randomUUID() }
}

export type Vote = 'agree' | 'disagree'
export interface ProjectionVoteState {
  yourVote: Vote | null
  global: { agree: number; disagree: number } | null  // null until the user has voted (reveal-after-vote)
  loading: boolean
  vote: (choice: Vote) => void
}

/** Per-pair agree/disagree vote with a global "agreement with our model" tally.
 *  Pass pairKey=null (e.g. list view) to no-op. */
export function useProjectionVote(
  tournamentId: string,
  category: 'men' | 'women',
  pairKey: string | null,
): ProjectionVoteState {
  const [yourVote, setYourVote] = useState<Vote | null>(null)
  const [global, setGlobal] = useState<{ agree: number; disagree: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pairKey) { setYourVote(null); setGlobal(null); return }
    let cancelled = false
    setLoading(true)
    const deviceId = getDeviceId()
    const qs = new URLSearchParams({ tournamentId, category, pairKey, deviceId })
    fetch(`/api/projection-vote?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setYourVote(data.yourVote ?? null)
        setGlobal(data.global ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tournamentId, category, pairKey])

  const vote = useCallback((choice: Vote) => {
    if (!pairKey) return
    setYourVote(choice)  // optimistic
    const deviceId = getDeviceId()
    fetch('/api/projection-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId, category, pairKey, deviceId, vote: choice }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { setYourVote(data.yourVote ?? choice); setGlobal(data.global ?? null) } })
      .catch(() => {})
  }, [tournamentId, category, pairKey])

  return { yourVote, global, loading, vote }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep useProjectionVote || echo CLEAN
git add src/hooks/useProjectionVote.ts
git commit -m "feat(projection-vote): useProjectionVote hook"
```

---

## Task 6: i18n keys

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Add to the `projectionTab` namespace in all 5 files**

| key | en | es | pt | it | fr |
|---|---|---|---|---|---|
| `ourPrediction` | Our prediction | Nuestra predicción | A nossa previsão | La nostra previsione | Notre prédiction |
| `projectedToReach` | Projected to reach the {round} | Llegará a {round} | Vai chegar a {round} | Arriverà a {round} | Atteindra {round} |
| `agreeWithCall` | Do you agree with our call? | ¿Estás de acuerdo? | Concordas? | Sei d’accordo? | Êtes-vous d’accord ? |
| `agree` | Agree | De acuerdo | Concordo | D’accordo | D’accord |
| `disagree` | Disagree | En desacuerdo | Discordo | Non d’accordo | Pas d’accord |
| `fansAgree` | {pct}% of fans agree with our model | El {pct}% está de acuerdo con nuestro modelo | {pct}% concordam com o nosso modelo | Il {pct}% è d’accordo col nostro modello | {pct}% sont d’accord avec notre modèle |
| `voteCount` | {count} votes | {count} votos | {count} votos | {count} voti | {count} votes |

(`ROUND_LABEL_KEY` already provides the localized round name for the `{round}` param.)

- [ ] **Step 2: Validate + commit**

```bash
node -e "for(const l of ['en','es','pt','it','fr']){const m=require('./src/messages/'+l+'.json');for(const k of ['ourPrediction','projectedToReach','agreeWithCall','agree','disagree','fansAgree','voteCount'])if(!m.projectionTab[k])throw new Error(l+' '+k)}console.log('i18n OK')"
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(projection-vote): i18n for prediction + vote (5 locales)"
```

---

## Task 7: Wire the prediction + vote card into `ProjectionTab`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

- [ ] **Step 1: Imports + hooks**

Add imports near the top:
```ts
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { useProjectionVote } from '@/hooks/useProjectionVote'
import { buildPlayerLookup, buildRoadVM, projectedFinishRound, ROUND_LABEL_KEY, type RoadOpponentVM } from '@/lib/projection-view'
```
(Merge `projectedFinishRound` into the existing `projection-view` import; drop the duplicate import line.)

Inside the component, BEFORE the early returns (alongside the other hooks, after `useProjection`):
```ts
  const voteEnabled = useFeatureFlag(FLAG_KEYS.PROJECTION_VOTE_ENABLED)
  const projVote = useProjectionVote(tournamentId, category, selectedPair)
```

- [ ] **Step 2: Render the card** — in the road view, immediately AFTER the hero block's closing `</div>` and BEFORE the `{t('projectedPath')}` label. Insert:

```tsx
          {vm.status === 'active' && (() => {
            const pr = projectedFinishRound(vm.rounds)
            if (!pr) return null
            const roundLabel = t(ROUND_LABEL_KEY[pr])
            const total = (projVote.global?.agree ?? 0) + (projVote.global?.disagree ?? 0)
            const pct = total > 0 ? Math.round(((projVote.global!.agree) / total) * 100) : 0
            return (
              <div style={{ padding: '12px 15px', marginBottom: 16, background: CARD, border: '1px solid rgba(255,255,255,0.07)', clipPath: CHUNK_CARD }}>
                <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('ourPrediction')}</div>
                <div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginTop: 3 }}>{t('projectedToReach', { round: roundLabel })}</div>
                {voteEnabled && (
                  projVote.global ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', clipPath: 'polygon(0.5% 0, 100% 0, 99.5% 100%, 0 100%)' }}>
                        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: `linear-gradient(90deg, ${LIME}, #5fb314)` }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{t('fansAgree', { pct })}</span>
                        <span style={{ color: MUTED, fontSize: 10, fontWeight: 600 }}>{t('voteCount', { count: total.toLocaleString() })}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {(['agree', 'disagree'] as const).map((choice) => {
                          const on = projVote.yourVote === choice
                          return (
                            <button key={choice} onClick={() => projVote.vote(choice)}
                              style={{ flex: 1, padding: '7px 0', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, cursor: 'pointer', clipPath: CHUNK_CARD,
                                background: on ? (choice === 'agree' ? LIME : LIVE) : 'rgba(255,255,255,0.05)',
                                color: on ? (choice === 'agree' ? '#06210a' : '#2a0708') : SECONDARY,
                                border: `1px solid ${on ? 'transparent' : 'rgba(255,255,255,0.1)'}` }}>
                              {choice === 'agree' ? `👍 ${t('agree')}` : `👎 ${t('disagree')}`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{t('agreeWithCall')}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['agree', 'disagree'] as const).map((choice) => (
                          <button key={choice} onClick={() => projVote.vote(choice)}
                            style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, cursor: 'pointer', clipPath: CHUNK_CARD, background: 'rgba(255,255,255,0.05)', color: TEXT, border: '1px solid rgba(255,255,255,0.1)' }}>
                            {choice === 'agree' ? `👍 ${t('agree')}` : `👎 ${t('disagree')}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )
          })()}
```

Notes: `CARD`, `CHUNK_CARD`, `TEXT`, `SECONDARY`, `MUTED`, `LIME`, `LIVE` are existing module consts in this file. The card shows the **prediction headline always** (active pairs); the vote block only when `voteEnabled`. `projVote.global` being non-null is the "already voted" signal (reveal-after-vote), so both states (buttons-only vs bar+buttons) are handled.

- [ ] **Step 2b: Optimistic reveal** — when the user votes from the buttons-only state, `projVote.global` is null until the POST resolves; that's fine (a brief beat, then the bar appears). No extra work.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npx tsc --noEmit 2>&1 | grep ProjectionTab || echo CLEAN
npx eslint "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
```
Fix any unused-import errors (e.g. ensure the merged `projection-view` import has no duplicate).

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "feat(projection-vote): prediction headline + flagged model-agreement vote card"
```

---

## Task 8: Verify live

**Files:** none (verification).

- [ ] **Step 1:** Restart the dev server (loads new i18n + flag): kill the `:3000` listener + parent, `npm run dev`, wait for ready. (The external-volume watcher misses message/JSON changes — a restart is required.)

- [ ] **Step 2:** On a Premier draw with active pairs (e.g. ITALY MAJOR or VALENCIA P1), open a pair's road. Verify:
  - "Our prediction — Projected to reach the {round}" shows for active pairs (matches the deepest ≥50% round).
  - With `projection_vote_enabled` local-ON: 👍/👎 buttons show; tapping one reveals "{pct}% of fans agree with our model · N votes", choice highlighted; tapping the other flips it and the bar/count update.
  - Drilling into another pair shows that pair's prediction + (since you've voted) the global bar.
  - Finished pairs (champion/eliminated) show NO prediction card.
  - Console has no MISSING_MESSAGE / projection errors.

- [ ] **Step 3:** Confirm persistence: reload → your vote on a pair is still highlighted (GET re-hydrates from `voter_id`).

- [ ] **Step 4:** Commit any fixes; report.

---

## Self-review (done during authoring)

**Spec coverage:** prediction headline (deepest ≥50% round) → Task 3 + Task 7; card under hero above projected path → Task 7; contextual 👍/👎 → Task 7; global tally + reveal-after-vote (server-gated) → Task 4; device-id/account voter → Task 4/5; `projection_votes` table → Task 1; `projection_vote_enabled` flag → Task 2; i18n → Task 6; experiment OFF in prod → Task 2 (enabled=false); no worker/projection-data change → confirmed. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Vote` ('agree'|'disagree'), `projectedFinishRound(rounds): ProjRound|null`, `useProjectionVote(tournamentId, category, pairKey): { yourVote, global, loading, vote }`, route GET/POST shapes (`{ yourVote, hasVotedEver, global }` / `{ yourVote, global }`) are consistent across Tasks 3–7. `ROUND_LABEL_KEY` keys match `ProjRound`. ✓

## Notes
- Continues on `feat/projection-picker`. Ships behind `projection_vote_enabled` (prod OFF). Migrations are idempotent (`if not exists` / `on conflict do nothing`) and applied via the pg driver.
- Anon→login voter-id transition can double-count one user (experiment-acceptable; noted in the spec).
