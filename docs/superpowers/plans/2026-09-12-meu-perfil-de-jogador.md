# Meu perfil de jogador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um usuário logado pede o vínculo com um jogador amador, o operador aprova no admin, e o atalho "meu perfil de jogador" aparece no `/profile` e no menu do avatar.

**Architecture:** A fila (`player_claims`) espelha `player_suggestions`; o vínculo aprovado é uma coluna em `profiles`, com índice único parcial garantindo um jogador por conta e uma conta por jogador. Toda leitura de estado passa por uma rota de servidor (`GET /api/me/player`), porque `player_claims` tem RLS deny-by-default e o browser não a enxerga.

**Tech Stack:** Next.js 16 (App Router, rotas em `src/app/api`), React 19, TypeScript, Supabase (service-role nas rotas), Auth.js (`auth()` de `@/auth`), next-intl (5 locales), Vitest.

**Spec:** [2026-09-12-meu-perfil-de-jogador-design.md](../specs/2026-09-12-meu-perfil-de-jogador-design.md)

---

## Contexto que o implementador precisa

**Onde rodar:** worktree `.worktrees/amateur-profiles`, branch `feat/amateur-admin-v2`. Dev server: `npm run dev` (porta 3002). Admin: `apps/ops`, projeto npm independente (`cd apps/ops && npm run dev`).

**Estilo do código de UI do usuário:** estilos inline, sem Tailwind, constantes de cor no topo do arquivo. Siga o que já está em `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`. **Não** introduza biblioteca nova.

**Estilo do admin:** primitivos de `@/components/ui` (`PageHeader`, `Section`, `Panel`, `Button`, `EmptyState`, `Skeleton`), sem hex hardcoded. Veja `apps/ops/src/app/(app)/player-suggestions/_components/SuggestionsTab.tsx`.

**Autenticação nas rotas do app:** `import { auth } from '@/auth'`, depois `const session = await auth()`; o id do usuário é `session.user.id`. Nas rotas do admin: `import { auth } from '@/lib/auth'` e cheque `session?.user?.isOperator`.

**Cliente Supabase nas rotas:** `import { createServerClient } from '@/lib/supabase'` (app) / `import { serviceClient } from '@/lib/supabase'` (ops). Ambos usam a service key e passam por cima de RLS — por isso toda validação tem que ser explícita no código.

**A migração não é aplicada por você.** Escreva o arquivo e comite. Aplicar em produção é decisão do Gustavo — ele aplica com o método do repo (driver `pg` + `DATABASE_URL`, não `supabase db push`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260912180000_player_claims.sql` | Tabela da fila + coluna do vínculo + índices únicos |
| `src/lib/player-claim.ts` | Função pura que decide se um pedido é aceitável. Onde a regra mora |
| `src/lib/__tests__/player-claim.test.ts` | Um caso por linha da tabela de recusas |
| `src/app/api/player/[id]/claim/route.ts` | POST — recebe o pedido, monta o contexto, chama a função pura, grava |
| `src/app/api/me/player/route.ts` | GET — estado do vínculo da conta logada (`none` / `pending` / `linked`) |
| `src/hooks/useMyPlayer.ts` | Consome a rota acima; cache de módulo para `/profile` e o menu não buscarem duas vezes |
| `src/components/ClaimProfileRow.tsx` | A linha "Sou eu" / "pedido em análise" na aba Resumo |
| `src/components/MyPlayerCard.tsx` | O card do `/profile` |
| `apps/ops/src/app/api/internal/player-claims/route.ts` | GET — lista para o operador |
| `apps/ops/src/app/api/internal/player-claims/[id]/route.ts` | POST — approve / reject / unlink |
| `apps/ops/src/app/api/internal/player-claims/count/route.ts` | GET — contador de pendentes para o rail |
| `apps/ops/src/app/(app)/player-claims/page.tsx` + `_components/ClaimsTab.tsx` | A tela de revisão |

---

### Task 1: Migração

**Files:**
- Create: `supabase/migrations/20260912180000_player_claims.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- 20260912180000_player_claims.sql
-- Vínculo entre uma conta logada e um registro de jogador ("meu perfil de
-- jogador"). O pedido entra em player_claims e é aprovado no admin; a
-- aprovação grava profiles.player_id.
--
-- Acesso: só por rotas de API com a service key. RLS habilitada sem policy
-- anon = deny-by-default no browser, igual a player_suggestions.

create table if not exists public.player_claims (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  player_name  text,
  user_id      uuid not null,
  user_email   text,
  note         text,
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now()
);

create index if not exists player_claims_pending_idx
  on public.player_claims (created_at desc) where status = 'pending';

-- Um pedido pendente por conta e jogador. Sem isto, tocar duas vezes no botão
-- gera duas linhas idênticas na fila do operador.
create unique index if not exists player_claims_pending_uk
  on public.player_claims (user_id, player_id) where status = 'pending';

alter table public.player_claims enable row level security;

comment on table public.player_claims is
  'Pedidos de vínculo conta→jogador, revisados na aba Claims do admin.';

alter table public.profiles
  add column if not exists player_id uuid references public.players(id) on delete set null;

-- A restrição que mais importa: um jogador pertence a no máximo uma conta.
-- Sem ela, dois pedidos aprovados por distração deixam duas contas donas do
-- mesmo jogador e nada no sistema reclama.
create unique index if not exists profiles_player_id_uk
  on public.profiles (player_id) where player_id is not null;

comment on column public.profiles.player_id is
  'Jogador vinculado a esta conta, aprovado via player_claims. NULL = conta sem perfil de jogador.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260912180000_player_claims.sql
git commit -m "feat(claim): migration for player_claims + profiles.player_id"
```

---

### Task 2: A regra, como função pura

**Files:**
- Create: `src/lib/player-claim.ts`
- Test: `src/lib/__tests__/player-claim.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/__tests__/player-claim.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateClaim, NOTE_MAX_LENGTH, type ClaimContext } from '../player-claim'

const base: ClaimContext = {
  userId: 'user-1',
  player: { id: 'player-1', tier: 'amateur' },
  playerOwnerUserId: null,
  accountPlayerId: null,
  hasPendingClaim: false,
}

describe('evaluateClaim', () => {
  it('accepts a logged-in user claiming an unclaimed amateur', () => {
    expect(evaluateClaim(base)).toEqual({ ok: true })
  })

  it('rejects an anonymous visitor', () => {
    expect(evaluateClaim({ ...base, userId: null }))
      .toEqual({ ok: false, reason: 'unauthenticated', status: 401 })
  })

  it('rejects an unknown player', () => {
    expect(evaluateClaim({ ...base, player: null }))
      .toEqual({ ok: false, reason: 'not_found', status: 404 })
  })

  it('rejects a professional — only amateurs are claimable', () => {
    expect(evaluateClaim({ ...base, player: { id: 'player-1', tier: 'pro' } }))
      .toEqual({ ok: false, reason: 'not_claimable', status: 403 })
  })

  it('rejects a player already linked to another account', () => {
    expect(evaluateClaim({ ...base, playerOwnerUserId: 'user-2' }))
      .toEqual({ ok: false, reason: 'already_claimed', status: 409 })
  })

  it('rejects a player already linked to this same account', () => {
    expect(evaluateClaim({ ...base, playerOwnerUserId: 'user-1', accountPlayerId: 'player-1' }))
      .toEqual({ ok: false, reason: 'already_claimed', status: 409 })
  })

  it('rejects an account that already owns a different player', () => {
    expect(evaluateClaim({ ...base, accountPlayerId: 'player-9' }))
      .toEqual({ ok: false, reason: 'account_linked', status: 409 })
  })

  it('rejects a duplicate pending request', () => {
    expect(evaluateClaim({ ...base, hasPendingClaim: true }))
      .toEqual({ ok: false, reason: 'pending', status: 409 })
  })

  it('checks identity before ownership — an anonymous visitor is never told who owns the player', () => {
    expect(evaluateClaim({ ...base, userId: null, playerOwnerUserId: 'user-2' }))
      .toEqual({ ok: false, reason: 'unauthenticated', status: 401 })
  })
})

describe('NOTE_MAX_LENGTH', () => {
  it('caps the free-text note', () => {
    expect(NOTE_MAX_LENGTH).toBe(280)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/player-claim.test.ts`
Expected: FAIL — `Failed to resolve import "../player-claim"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/player-claim.ts
// A regra de quem pode reivindicar qual jogador, isolada da rota.
//
// Está aqui como função pura porque é a única parte do vínculo que merece
// testes de verdade: a rota só monta o contexto e grava. Toda recusa tem um
// código próprio para que a tela possa dizer o que aconteceu — "já é de
// outra conta" e "você já tem um jogador" são problemas diferentes para
// quem está do outro lado.

export type ClaimRejection =
  | 'unauthenticated'
  | 'not_found'
  | 'not_claimable'
  | 'already_claimed'
  | 'account_linked'
  | 'pending'

/** Teto do texto livre do pedido. Curto de propósito: é um recado para o
 *  operador ("sou o Eric, capitão"), não um formulário. */
export const NOTE_MAX_LENGTH = 280

/** Só jogadores amadores podem ser reivindicados. Um pedido para um
 *  profissional não tem upside — só gera fila para recusar. */
export const CLAIMABLE_TIER = 'amateur'

/** O jogador vinculado, como as duas telas o consomem. Mora aqui — e não no
 *  arquivo da rota nem no do hook — porque a rota (servidor) e o hook
 *  (`'use client'`) precisam do mesmo tipo e nenhum dos dois pode importar do
 *  outro sem arrastar junto o que não deve. */
export interface MyPlayerLinked {
  id: string
  name: string
  avatarUrl: string | null
  badgeLabel: string | null
  teamName: string | null
  isCaptain: boolean
}

export interface ClaimContext {
  /** id da sessão, ou null se não houver */
  userId: string | null
  /** o jogador alvo, ou null se o id não existe */
  player: { id: string; tier: string | null } | null
  /** conta que já é dona deste jogador, se houver */
  playerOwnerUserId: string | null
  /** jogador que esta conta já possui, se houver */
  accountPlayerId: string | null
  /** já existe pedido pendente desta conta para este jogador */
  hasPendingClaim: boolean
}

export type ClaimVerdict =
  | { ok: true }
  | { ok: false; reason: ClaimRejection; status: number }

export function evaluateClaim(ctx: ClaimContext): ClaimVerdict {
  // A ordem importa. Identidade primeiro: um visitante anônimo nunca deve
  // descobrir, pela mensagem de erro, quem é dono de qual perfil.
  if (!ctx.userId) return { ok: false, reason: 'unauthenticated', status: 401 }
  if (!ctx.player) return { ok: false, reason: 'not_found', status: 404 }
  if (ctx.player.tier !== CLAIMABLE_TIER) return { ok: false, reason: 'not_claimable', status: 403 }
  if (ctx.playerOwnerUserId) return { ok: false, reason: 'already_claimed', status: 409 }
  if (ctx.accountPlayerId) return { ok: false, reason: 'account_linked', status: 409 }
  if (ctx.hasPendingClaim) return { ok: false, reason: 'pending', status: 409 }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/player-claim.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-claim.ts src/lib/__tests__/player-claim.test.ts
git commit -m "feat(claim): pure rule for who may claim which player"
```

---

### Task 3: Rota do pedido

**Files:**
- Create: `src/app/api/player/[id]/claim/route.ts`

- [ ] **Step 1: Escrever a rota**

```ts
// src/app/api/player/[id]/claim/route.ts
// POST — o usuário logado pede o vínculo com um jogador amador.
// A decisão mora em src/lib/player-claim.ts; aqui só montamos o contexto,
// gravamos, e traduzimos a recusa em status HTTP.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import { evaluateClaim, NOTE_MAX_LENGTH } from '@/lib/player-claim'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await params
  const session = await auth()
  const userId = session?.user?.id ?? null

  const body = (await req.json().catch(() => ({}))) as { note?: unknown }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX_LENGTH) : null

  const supabase = createServerClient()

  // Um pedido anônimo não daria ao operador nada para julgar — e sem userId
  // as três consultas abaixo não fazem sentido. Corta antes.
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const [playerRes, ownerRes, accountRes, pendingRes] = await Promise.all([
    supabase.from('players').select('id, tier, name, display_name').eq('id', playerId).maybeSingle(),
    supabase.from('profiles').select('id').eq('player_id', playerId).maybeSingle(),
    supabase.from('profiles').select('player_id').eq('id', userId).maybeSingle(),
    supabase.from('player_claims').select('id')
      .eq('user_id', userId).eq('player_id', playerId).eq('status', 'pending').maybeSingle(),
  ])

  if (playerRes.error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })

  const verdict = evaluateClaim({
    userId,
    player: playerRes.data ? { id: playerRes.data.id, tier: playerRes.data.tier } : null,
    playerOwnerUserId: ownerRes.data?.id ?? null,
    accountPlayerId: accountRes.data?.player_id ?? null,
    hasPendingClaim: !!pendingRes.data,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: verdict.status })
  }

  const { error } = await supabase.from('player_claims').insert({
    player_id: playerId,
    player_name: playerRes.data!.display_name ?? playerRes.data!.name,
    user_id: userId,
    user_email: session?.user?.email ?? null,
    note,
  })
  if (error) {
    // 23505 = violação do índice único parcial: uma corrida entre dois cliques
    // rápidos. Do ponto de vista de quem clicou, o pedido está na fila.
    if (error.code === '23505') return NextResponse.json({ error: 'pending' }, { status: 409 })
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'pending' })
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros apontando para `src/app/api/player/[id]/claim/route.ts`

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/player/[id]/claim/route.ts"
git commit -m "feat(claim): POST /api/player/[id]/claim"
```

---

### Task 4: Rota do estado do vínculo

**Files:**
- Create: `src/app/api/me/player/route.ts`

- [ ] **Step 1: Escrever a rota**

```ts
// src/app/api/me/player/route.ts
// GET — o estado do vínculo da conta logada, em uma chamada:
//   { status: 'none' }
//   { status: 'pending', playerName }
//   { status: 'linked', player: { … } }
//
// Existe como rota de servidor porque player_claims é deny-by-default no
// browser: o estado "pending" não é legível pelo cliente anon de jeito nenhum.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { MyPlayerLinked } from '@/lib/player-claim'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  // Sem sessão não é erro — é só "não tem vínculo". A UI trata os dois igual.
  if (!userId) return NextResponse.json({ status: 'none' })

  const supabase = createServerClient()

  const { data: profile } = await supabase
    .from('profiles').select('player_id').eq('id', userId).maybeSingle()

  if (!profile?.player_id) {
    const { data: pending } = await supabase
      .from('player_claims').select('player_name')
      .eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (pending) return NextResponse.json({ status: 'pending', playerName: pending.player_name })
    return NextResponse.json({ status: 'none' })
  }

  const { data: player } = await supabase
    .from('players').select('id, name, display_name, avatar_url')
    .eq('id', profile.player_id).maybeSingle()
  if (!player) return NextResponse.json({ status: 'none' })

  // Insígnia e capitania vêm do vínculo com a equipe na temporada mais
  // recente. Ausência de equipe não é erro — o card mostra só o nome.
  const { data: membership } = await supabase
    .from('team_memberships')
    .select('is_captain, team_season:team_seasons(label, team:teams(name, badge_label))')
    .eq('player_id', player.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const season = membership?.team_season as unknown as
    { label: string; team: { name: string; badge_label: string | null } | null } | null

  const linked: MyPlayerLinked = {
    id: player.id,
    name: player.display_name?.trim() || player.name,
    avatarUrl: player.avatar_url,
    badgeLabel: season?.team?.badge_label ?? null,
    teamName: season?.team?.name ?? null,
    isCaptain: membership?.is_captain ?? false,
  }

  return NextResponse.json({ status: 'linked', player: linked })
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros apontando para `src/app/api/me/player/route.ts`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/me/player/route.ts
git commit -m "feat(claim): GET /api/me/player returns link state"
```

---

### Task 5: Hook `useMyPlayer`

**Files:**
- Create: `src/hooks/useMyPlayer.ts`

- [ ] **Step 1: Escrever o hook**

```ts
'use client'
// src/hooks/useMyPlayer.ts
// Estado do vínculo da conta com um jogador, compartilhado entre o /profile
// e o menu do avatar.
//
// O cache de módulo existe porque os dois montam juntos quando o usuário
// abre o menu estando no /profile: sem ele seriam duas chamadas idênticas na
// mesma renderização. Invalida no logout, via mudança do user.id.

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import type { MyPlayerLinked } from '@/lib/player-claim'

export type { MyPlayerLinked }

export type MyPlayerState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'pending'; playerName: string | null }
  | { status: 'linked'; player: MyPlayerLinked }

type Cached = Exclude<MyPlayerState, { status: 'loading' }>

let cacheUserId: string | null = null
let cacheValue: Cached | null = null
let inFlight: Promise<Cached> | null = null

async function load(userId: string): Promise<Cached> {
  if (cacheUserId === userId && cacheValue) return cacheValue
  if (cacheUserId !== userId) { cacheValue = null; inFlight = null; cacheUserId = userId }
  if (!inFlight) {
    inFlight = fetch('/api/me/player')
      .then(r => (r.ok ? r.json() : { status: 'none' }))
      .catch(() => ({ status: 'none' }) as Cached)
      .then((v: Cached) => { cacheValue = v; inFlight = null; return v })
  }
  return inFlight
}

/** Limpa o cache — chame depois de enviar um pedido, para o estado
 *  "pending" aparecer sem recarregar a página. */
export function invalidateMyPlayer() {
  cacheValue = null
  inFlight = null
}

export function useMyPlayer(): MyPlayerState {
  const { user, loading } = useAuth()
  const [state, setState] = useState<MyPlayerState>({ status: 'loading' })

  useEffect(() => {
    if (loading) return
    if (!user) { setState({ status: 'none' }); return }
    let cancelled = false
    load(user.id).then(v => { if (!cancelled) setState(v) })
    return () => { cancelled = true }
  }, [user, loading])

  return state
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros apontando para `src/hooks/useMyPlayer.ts`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMyPlayer.ts
git commit -m "feat(claim): useMyPlayer hook with module cache"
```

---

### Task 6: Textos nos 5 locales

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Adicionar as chaves ao namespace `amateur` (as do perfil do jogador)**

Em `en.json`, dentro de `"amateur"`, depois de `"suggestCta"`:

```json
"claimPrompt": "Is this you?",
"claimCta": "Claim this profile",
"claimPending": "Request under review",
"claimYours": "This is your profile",
"claimFailed": "Couldn't send the request. Try again."
```

`es.json`: `"claimPrompt": "¿Eres tú?"`, `"claimCta": "Reclamar este perfil"`, `"claimPending": "Solicitud en revisión"`, `"claimYours": "Este es tu perfil"`, `"claimFailed": "No se pudo enviar la solicitud. Inténtalo de nuevo."`

`pt.json`: `"claimPrompt": "É você?"`, `"claimCta": "Reivindicar este perfil"`, `"claimPending": "Pedido em análise"`, `"claimYours": "Este é o seu perfil"`, `"claimFailed": "Não foi possível enviar o pedido. Tente de novo."`

`it.json`: `"claimPrompt": "Sei tu?"`, `"claimCta": "Rivendica questo profilo"`, `"claimPending": "Richiesta in revisione"`, `"claimYours": "Questo è il tuo profilo"`, `"claimFailed": "Impossibile inviare la richiesta. Riprova."`

`fr.json`: `"claimPrompt": "C'est vous ?"`, `"claimCta": "Revendiquer ce profil"`, `"claimPending": "Demande en cours d'examen"`, `"claimYours": "C'est votre profil"`, `"claimFailed": "Impossible d'envoyer la demande. Réessayez."`

- [ ] **Step 2: Adicionar as chaves ao namespace `profile` (as do /profile e do menu)**

Em `en.json`, dentro de `"profile"`:

```json
"myPlayer": "My player profile",
"myPlayerPending": "Request under review"
```

`es.json`: `"myPlayer": "Mi perfil de jugador"`, `"myPlayerPending": "Solicitud en revisión"`
`pt.json`: `"myPlayer": "Meu perfil de jogador"`, `"myPlayerPending": "Pedido em análise"`
`it.json`: `"myPlayer": "Il mio profilo giocatore"`, `"myPlayerPending": "Richiesta in revisione"`
`fr.json`: `"myPlayer": "Mon profil joueur"`, `"myPlayerPending": "Demande en cours d'examen"`

- [ ] **Step 3: Verificar que os cinco arquivos continuam JSON válido**

Run: `for f in src/messages/{en,es,pt,it,fr}.json; do node -e "require('./$f')" && echo "$f ok"; done`
Expected: cinco linhas `ok`

- [ ] **Step 4: Commit**

```bash
git add src/messages
git commit -m "i18n(claim): claim + my-player strings in 5 locales"
```

---

### Task 7: A linha "Sou eu" no perfil do jogador

**Files:**
- Create: `src/components/ClaimProfileRow.tsx`
- Modify: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// src/components/ClaimProfileRow.tsx
// "Sou eu" na aba Resumo do perfil amador.
//
// Fica junto de "sugerir correção" — mesma família de ação — e deliberadamente
// FORA do hero: aquela faixa já truncou o nome do Tapia por causa do botão de
// share e "Eric Ortega" por causa da insígnia de capitão.
//
// Só aparece para usuário logado, em jogador ainda não vinculado. Quem não é
// jogador nunca esbarra nisso: não há convite no /profile.

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useMyPlayer, invalidateMyPlayer } from '@/hooks/useMyPlayer'

const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'
const GREEN = '#7ED321'

export function ClaimProfileRow({ playerId }: { playerId: string }) {
  const t = useTranslations('amateur')
  const { user } = useAuth()
  const mine = useMyPlayer()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  // Sem sessão não há o que reivindicar, e um convite para "entre e reivindique"
  // seria ruído num perfil que a maioria das visitas nunca vai reivindicar.
  if (!user) return null
  if (mine.status === 'loading') return null
  if (mine.status === 'linked' && mine.player.id !== playerId) return null
  if (mine.status === 'linked') {
    return (
      <Row>
        <span style={{ color: GREEN }}>{t('claimYours')}</span>
      </Row>
    )
  }
  if (mine.status === 'pending' || sent) {
    return (
      <Row>
        <span>{t('claimPending')}</span>
      </Row>
    )
  }

  const submit = async () => {
    setSending(true)
    setFailed(false)
    const res = await fetch(`/api/player/${playerId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null)
    setSending(false)
    // 409 pending também é sucesso do ponto de vista de quem clicou: o pedido
    // está na fila. Só erro real vira mensagem de erro.
    if (res && (res.ok || res.status === 409)) {
      invalidateMyPlayer()
      setSent(true)
      return
    }
    setFailed(true)
  }

  return (
    <Row>
      <span>{t('claimPrompt')}{' '}
        <button
          onClick={submit}
          disabled={sending}
          style={{ background: 'none', border: 'none', padding: 0, color: ORANGE, font: 'inherit', cursor: 'pointer' }}
        >
          {t('claimCta')}
        </button>
      </span>
      {failed && <span style={{ color: '#FF4655', marginLeft: 6 }}>{t('claimFailed')}</span>}
    </Row>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div style={{
      gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8,
      border: '1px dashed #2A2A2A', padding: '9px 10px', fontSize: 10, color: MUTED,
    }}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Montar na aba Resumo**

Em `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`, adicione o import junto dos outros:

```tsx
import { ClaimProfileRow } from '@/components/ClaimProfileRow'
```

E insira o componente **logo depois** do bloco de sugerir correção (o `<div>` com `border: '1px dashed #2A2A2A'` que contém `t('suggestPrompt')`), antes do bloco `{data.season.notes && (`:

```tsx
      <ClaimProfileRow playerId={player.id} />
```

- [ ] **Step 3: Verificar que compila e o lint passa**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/components/ClaimProfileRow.tsx "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"
git commit -m "feat(claim): claim row on the amateur Summary tab"
```

---

### Task 8: O card no /profile

**Files:**
- Create: `src/components/MyPlayerCard.tsx`
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Criar o card**

```tsx
'use client'
// src/components/MyPlayerCard.tsx
// "Meu perfil de jogador" no /profile.
//
// Fica entre o StatsStrip e Conquistas, acima de Atividade: Atividade é "o que
// eu fiz no app" — ao lado de "Partidas salvas", "quem eu sou" viraria só mais
// um item de lista.
//
// O estado pendente é cinza, sem seta e não clicável de propósito: ele existe
// para responder "e aí, cadê?" sem prometer uma navegação que ainda não existe.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import Avatar from '@/components/Avatar'
import { useMyPlayer } from '@/hooks/useMyPlayer'

const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const CARD = '#141414'
const CLIP = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export function MyPlayerCard() {
  const t = useTranslations('profile')
  const router = useRouter()
  const mine = useMyPlayer()

  if (mine.status === 'loading' || mine.status === 'none') return null

  if (mine.status === 'pending') {
    return (
      <div style={{
        background: CARD, clipPath: CLIP, borderLeft: `3px solid ${MUTED}`,
        padding: '12px 14px', margin: '0 16px 14px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', background: '#2A2A2A', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 15,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
            {t('myPlayer')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2 }}>
            {mine.playerName ?? ''}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{t('myPlayerPending')}</div>
        </div>
      </div>
    )
  }

  const p = mine.player
  return (
    <button
      type="button"
      onClick={() => router.push(`/player/${p.id}` as Parameters<typeof router.push>[0])}
      style={{
        width: 'calc(100% - 32px)', margin: '0 16px 14px', background: CARD, clipPath: CLIP,
        border: 'none', borderLeft: `3px solid ${ORANGE}`, padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        textAlign: 'left', font: 'inherit', color: 'inherit',
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: '50%', border: `2px solid ${ORANGE}`, overflow: 'hidden', flexShrink: 0 }}>
        <Avatar src={p.avatarUrl} alt="" size={34} fallback={p.name?.[0]} unoptimized />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
          {t('myPlayer')}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}
        </div>
        {p.badgeLabel && (
          <span style={{
            display: 'inline-block', marginTop: 4, background: '#7ED321', color: '#173404',
            fontSize: 8, fontWeight: 800, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {p.badgeLabel}
          </span>
        )}
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}
```

- [ ] **Step 2: Montar no /profile**

Em `src/app/[locale]/(app)/profile/page.tsx`, adicione o import junto dos outros componentes:

```tsx
import { MyPlayerCard } from '@/components/MyPlayerCard'
```

E insira **entre** `<StatsStrip … />` e `<LatestAchievementsStrip … />`:

```tsx
      <MyPlayerCard />
```

- [ ] **Step 3: Verificar que compila e o lint passa**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/components/MyPlayerCard.tsx "src/app/[locale]/(app)/profile/page.tsx"
git commit -m "feat(claim): my-player card on /profile"
```

---

### Task 9: A linha no menu do avatar

**Files:**
- Modify: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Adicionar a linha**

Importe o hook junto dos outros imports do arquivo:

```tsx
import { useMyPlayer } from '@/hooks/useMyPlayer'
```

Dentro do componente, junto das outras chamadas de hook:

```tsx
  const mine = useMyPlayer()
```

E dentro do bloco `{user && (<>…</>)}`, **antes** do `<Item href="/notifications" …>`:

```tsx
          {/* O card acima é "sua conta", esta linha é "seu jogador" — as duas
              identidades ficam juntas, e abaixo começa a lista de funções.
              O ícone é a foto do jogador, não um SVG verde como as outras
              linhas: é o que separa quem eu sou do que eu faço.
              O estado pendente NÃO entra aqui — menu é lista de destinos, e
              uma linha morta num dropdown é pior que linha nenhuma. */}
          {mine.status === 'linked' && (
            <Item
              href={`/player/${mine.player.id}`}
              onClick={onClose}
              icon={
                <div style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', border: '1.5px solid #F5A623' }}>
                  <Avatar src={mine.player.avatarUrl} alt="" size={18} fallback={mine.player.name?.[0]} unoptimized />
                </div>
              }
              label={t('myPlayer')}
              rightSlot={<Chevron/>}
            />
          )}
```

Se `Avatar` ainda não estiver importado no arquivo, adicione:

```tsx
import Avatar from '@/components/Avatar'
```

- [ ] **Step 2: Verificar que compila e o lint passa**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/components/ProfileMenu.tsx
git commit -m "feat(claim): my-player row in the avatar menu"
```

---

### Task 10: Rotas do admin

**Files:**
- Create: `apps/ops/src/app/api/internal/player-claims/route.ts`
- Create: `apps/ops/src/app/api/internal/player-claims/[id]/route.ts`
- Create: `apps/ops/src/app/api/internal/player-claims/count/route.ts`

- [ ] **Step 1: Listagem**

```ts
// apps/ops/src/app/api/internal/player-claims/route.ts
// Admin: lista pedidos de vínculo conta→jogador. Pendentes por padrão.
// ?status=all inclui os já revisados (últimos 100).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const status = new URL(request.url).searchParams.get('status') ?? 'pending'
  const supabase = serviceClient()

  let query = supabase
    .from('player_claims')
    .select('id, player_id, player_name, user_id, user_email, note, status, created_at, reviewed_at, review_note')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data ?? [] })
}
```

- [ ] **Step 2: Ações**

```ts
// apps/ops/src/app/api/internal/player-claims/[id]/route.ts
// Admin: approve | reject | unlink de um pedido de vínculo.
//
// Aprovar grava profiles.player_id. Se o jogador tiver sido vinculado entre o
// carregamento da lista e o clique, a gravação bate no índice único parcial
// (23505) e devolvemos 409 — em vez de sobrescrever em silêncio.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { action?: string; note?: string }
  const action = body.action
  if (action !== 'approve' && action !== 'reject' && action !== 'unlink') {
    return NextResponse.json({ error: 'bad_action' }, { status: 400 })
  }

  const supabase = serviceClient()
  const reviewer = session.user.email ?? 'operator'

  const { data: claim, error: loadErr } = await supabase
    .from('player_claims').select('id, player_id, user_id, status').eq('id', id).maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!claim) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (action === 'approve') {
    const { data: updated, error: linkErr } = await supabase
      .from('profiles')
      .update({ player_id: claim.player_id })
      .eq('id', claim.user_id)
      .select('id')
    if (linkErr) {
      if (linkErr.code === '23505') {
        return NextResponse.json({ error: 'already_claimed' }, { status: 409 })
      }
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }
    // Zero linhas = não existe profile para este user_id. Não é para acontecer,
    // mas marcar a claim como aprovada sem vínculo criaria um estado mentiroso.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'profile_missing' }, { status: 409 })
    }
  }

  if (action === 'unlink') {
    const { error: unlinkErr } = await supabase
      .from('profiles').update({ player_id: null }).eq('id', claim.user_id)
    if (unlinkErr) return NextResponse.json({ error: unlinkErr.message }, { status: 500 })
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected'
  const { error: statusErr } = await supabase
    .from('player_claims')
    .update({
      status: newStatus,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      review_note: body.note ?? (action === 'unlink' ? 'unlinked' : null),
    })
    .eq('id', id)
  if (statusErr) return NextResponse.json({ error: statusErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: newStatus })
}
```

- [ ] **Step 3: Contador**

```ts
// apps/ops/src/app/api/internal/player-claims/count/route.ts
// Admin: quantos pedidos de vínculo estão pendentes — alimenta o badge do rail.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { count, error } = await serviceClient()
    .from('player_claims')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: count ?? 0 })
}
```

- [ ] **Step 4: Verificar que compila**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros apontando para `src/app/api/internal/player-claims/*`

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/internal/player-claims
git commit -m "feat(claim): ops API for reviewing player claims"
```

---

### Task 11: A tela do admin

**Files:**
- Create: `apps/ops/src/app/(app)/player-claims/page.tsx`
- Create: `apps/ops/src/app/(app)/player-claims/_components/ClaimsTab.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: A página**

```tsx
import ClaimsTab from './_components/ClaimsTab'

export const metadata = { title: 'Claims · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PlayerClaimsPage() {
  return <ClaimsTab />
}
```

- [ ] **Step 2: A tabela de revisão**

```tsx
'use client'
// apps/ops/src/app/(app)/player-claims/_components/ClaimsTab.tsx
//
// Fila de pedidos "este jogador sou eu", enviados do perfil amador público.
//
// O e-mail da conta aparece em destaque porque é a ÚNICA evidência que o
// operador tem. Aprovar é dizer "sim, este endereço é o Eric" — sem o e-mail
// na frente, seria carimbar um UUID. Dentro de um clube o risco não é um
// estranho; é um colega pedir o perfil de outro colega.
//
// Fetches: GET /api/internal/player-claims
// Mutates: POST /api/internal/player-claims/[id]  ({action: approve|reject|unlink})

import { useEffect, useState } from 'react'
import { PageHeader, Section, Panel, Button, EmptyState, Skeleton } from '@/components/ui'

interface Claim {
  id: string
  player_id: string
  player_name: string | null
  user_id: string
  user_email: string | null
  note: string | null
  status: string
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

export default function ClaimsTab() {
  const [items, setItems] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  async function refresh(all: boolean) {
    setLoading(true)
    const r = await fetch(`/api/internal/player-claims?status=${all ? 'all' : 'pending'}`)
      .then((res) => res.json())
      .catch(() => ({ items: [] }))
    setItems(r.items ?? [])
    setLoading(false)
  }

  // Fetch-on-mount — mesmo padrão das outras abas de revisão do admin.
  useEffect(() => { refresh(showAll) }, [showAll])

  async function act(id: string, action: 'approve' | 'reject' | 'unlink') {
    const res = await fetch(`/api/internal/player-claims/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(
        d.error === 'already_claimed'
          ? 'This player was linked to another account in the meantime. Nothing was changed.'
          : `Failed: ${d.error ?? res.status}`,
      )
      return
    }
    refresh(showAll)
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Claims"
        subtitle="Players asking to be linked to their own account. The email is the evidence — approve only addresses you recognise."
      />

      <div style={{ marginBottom: 12 }}>
        <Button onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show pending only' : 'Show all (last 100)'}
        </Button>
      </div>

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <Section label={`${showAll ? 'Claims' : 'Pending claims'} (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState title="Empty" hint="No claims to review." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(c => (
                <Panel key={c.id}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{c.user_email ?? '(no email on account)'}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        claims <a href={`/players?id=${c.player_id}`}>{c.player_name ?? c.player_id}</a>
                      </div>
                      {c.note && <div style={{ fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>“{c.note}”</div>}
                      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
                        {new Date(c.created_at).toLocaleString()}
                        {c.status !== 'pending' && ` · ${c.status}`}
                        {c.review_note && ` · ${c.review_note}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {c.status === 'pending' && (
                        <>
                          <Button onClick={() => act(c.id, 'approve')}>Approve</Button>
                          <Button onClick={() => act(c.id, 'reject')}>Reject</Button>
                        </>
                      )}
                      {c.status === 'approved' && (
                        <Button onClick={() => act(c.id, 'unlink')}>Unlink</Button>
                      )}
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Entrada no rail**

Em `apps/ops/src/components/shell/Rail.tsx`, adicione um item logo abaixo do de Suggestions (linha 30):

```tsx
    { href: '/player-claims', label: 'Claims', icon: 'user-check' },
```

Se `'user-check'` não existir no mapa de ícones do arquivo, use `'flag'` — o mesmo de Suggestions.

- [ ] **Step 4: Verificar que compila e o lint passa**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/player-claims" apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(claim): ops Claims review tab"
```

---

### Task 12: Verificação manual ponta a ponta

Esta task não tem código. Ela só roda **depois** que o Gustavo aplicar a migração — sem as tabelas, tudo abaixo falha por motivo errado e o tempo é perdido perseguindo o erro errado.

- [ ] **Step 1: Confirmar que a migração foi aplicada**

Pergunte ao Gustavo. Não aplique você.

- [ ] **Step 2: Subir os dois servidores**

```bash
npm run dev
```

E, em outro terminal:

```bash
cd apps/ops && npm run dev
```

- [ ] **Step 3: Pedir o vínculo**

Logado com uma conta de teste, abra um perfil amador (`/player/<uuid>` de um jogador do Blue Padel), aba Resumo. Confirme: a linha "É você? Reivindicar este perfil" aparece no fim da grade. Clique. Confirme que ela vira "Pedido em análise" **sem recarregar a página**.

- [ ] **Step 4: Conferir que o convite não vaza**

Deslogue e abra o mesmo perfil. Confirme que **não** há linha de reivindicação nenhuma.

- [ ] **Step 5: Aprovar no admin**

Em `/player-claims`, confirme que o pedido aparece com o **e-mail da conta** em destaque. Aprove.

- [ ] **Step 6: Conferir os dois atalhos**

De volta no app, recarregue. Em `/profile`: o card laranja com foto, nome e insígnia, entre os números e Conquistas. No menu do avatar: a linha com a foto do jogador, logo abaixo do card da conta. Clique nos dois e confirme que levam ao `/player/<id>`.

- [ ] **Step 7: Desvincular**

No admin, clique em Unlink. Recarregue o app e confirme que **o card e a linha do menu somem**, e que a linha de reivindicação volta a aparecer no perfil do jogador.

- [ ] **Step 8: Conferir que um profissional não pode ser reivindicado**

Abra um perfil profissional qualquer logado. Confirme que não há linha de reivindicação (a aba Resumo do pro nem monta o componente — a confirmação é que nada quebrou).

- [ ] **Step 9: Provar o índice único — a corrida que o spec pede**

O spec pede um teste de "aprovar um jogador já vinculado a outra conta **falha** e não sobrescreve". Ele não vira teste automatizado aqui: a garantia mora num índice único parcial do Postgres, e o repo não tem harness de integração com banco — um teste com o Supabase mockado provaria o mock, não o índice. Então é verificação manual, uma vez:

1. Com o jogador X já vinculado à conta A (estado do Step 5), peça o mesmo jogador X com uma segunda conta B. O pedido é recusado ainda na rota, com `409 already_claimed` — confirme no Network do browser.
2. Para exercitar o caminho do admin, insira a claim direto no banco, contornando a rota:

```sql
insert into public.player_claims (player_id, user_id, user_email, status)
values ('<uuid-do-jogador-X>', '<uuid-da-conta-B>', 'conta-b@exemplo.com', 'pending');
```

3. Em `/player-claims`, clique em Approve nessa linha. **Esperado:** o alerta "This player was linked to another account in the meantime. Nothing was changed.", e a conta A continua dona do jogador.
4. Limpe: `delete from public.player_claims where user_email = 'conta-b@exemplo.com';`

Se o Approve passar em vez de falhar, o índice `profiles_player_id_uk` não foi criado — pare e volte à Task 1.

- [ ] **Step 10: Rodar a suíte inteira**

```bash
npx vitest run
```

Expected: verde, incluindo os 10 casos novos de `player-claim.test.ts`.

```bash
cd apps/ops && npx vitest run
```

Expected: verde (91 testes existentes, nenhum novo).
