# Perfil amador + equipes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar perfis de jogadores amadores em `/player/[id]`, com a mesma linguagem visual do perfil profissional, sustentados por um modelo de **equipe** reutilizável que também serve formatos profissionais por equipes.

**Architecture:** Amadores vivem na tabela `players` sob `tier='amateur'`, isolados do produto pro por um guard único no `PlayerResolver`. Seis tabelas novas modelam equipe → temporada → jornada → pista. A página `/player/[id]` ramifica por `tier` e renderiza um componente separado, sem tocar no caminho profissional. Os dados entram por um script de import CSV, sem telas de admin.

**Tech Stack:** Next.js 16 (App Router, client components), Supabase/PostgreSQL, TypeScript, Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-09-perfil-amador-e-equipes-design.md`](../specs/2026-09-09-perfil-amador-e-equipes-design.md)

**Worktree:** `.worktrees/amateur-profiles` · branch `feat/amateur-profiles-teams`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260909120000_amateur_profiles_teams.sql` | Colunas novas em `players` + as 6 tabelas de equipe + RLS |
| `src/lib/player-tier.ts` | Constantes e helpers de tier; ponto único de verdade sobre "o que é pro" |
| `src/lib/player-resolver.ts` | **Modificar** — excluir amadores do cache de resolução |
| `src/lib/amateur-profile.ts` | Fetch + montagem do `AmateurProfileData` a partir das tabelas de equipe |
| `src/lib/amateur-derive.ts` | Funções puras: aproveitamento, pista habitual, parceiros, forma |
| `src/app/[locale]/player/[id]/Widget.tsx` | **Modificar** — receber o `Last10SparkBar` extraído |
| `src/app/[locale]/player/[id]/page.tsx` | **Modificar** — ramificar por tier; remover o `Last10SparkBar` local |
| `src/app/[locale]/player/[id]/AmateurProfile.tsx` | Casca: hero + abas |
| `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` | Aba Resumo |
| `src/app/[locale]/player/[id]/amateur/SeasonTab.tsx` | Aba Temporada |
| `src/app/[locale]/player/[id]/amateur/TeamTab.tsx` | Aba Equipe |
| `src/app/sitemap-players.xml/route.ts` | **Modificar** — incluir amadores, excluir `hidden` |
| `scripts/import-amateur-season.ts` | Import CSV → banco, `--dry-run` / `--apply` |
| `scripts/lib/amateur-csv.ts` | Parsing puro do CSV (testável sem banco) |

Os três componentes de aba ficam em `amateur/` porque `AmateurProfile.tsx` sozinho passaria de 800 linhas. Cada aba tem uma responsabilidade e um recorte de dados próprio.

---

## Task 1: Migração do banco

**Files:**
- Create: `supabase/migrations/20260909120000_amateur_profiles_teams.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- 20260909120000_amateur_profiles_teams.sql
-- Amateur player profiles + reusable team model.
-- Amateurs share the players table under tier='amateur'; isolation from the
-- pro product is enforced in application code (see src/lib/player-tier.ts).

alter table public.players
  add column if not exists tier text not null default 'pro',
  add column if not exists home_club text,
  add column if not exists hidden boolean not null default false;

alter table public.players
  drop constraint if exists players_tier_check;
alter table public.players
  add constraint players_tier_check check (tier in ('pro','amateur'));

create index if not exists players_tier_idx
  on public.players (tier) where tier <> 'pro';

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  club        text,
  city        text,
  country     text,
  crest_url   text,
  competition text,
  category    text,
  source      text not null default 'manual',
  external_id text,
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists public.team_seasons (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  label          text not null,
  starts_on      date,
  ends_on        date,
  ranking        int,
  ties_played    int,
  ties_won       int,
  courts_won     int,
  courts_lost    int,
  points_for     int,
  points_against int,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (team_id, label)
);

create table if not exists public.team_memberships (
  id                 uuid primary key default gen_random_uuid(),
  team_season_id     uuid not null references public.team_seasons(id) on delete cascade,
  player_id          uuid not null references public.players(id) on delete cascade,
  competition_points numeric,
  competition_rank   int,
  roster_rank        int,
  games_played       int,
  wins               int,
  losses             int,
  created_at         timestamptz not null default now(),
  unique (team_season_id, player_id)
);

create table if not exists public.team_fixtures (
  id             uuid primary key default gen_random_uuid(),
  team_season_id uuid not null references public.team_seasons(id) on delete cascade,
  code           text not null,
  label          text not null,
  sort_order     int not null,
  played_on      date,
  opponent_name  text,
  complete       boolean not null default true,
  result         text,
  points_for     int,
  points_against int,
  courts_won     int,
  courts_lost    int,
  unique (team_season_id, code)
);

create table if not exists public.team_fixture_slots (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references public.team_fixtures(id) on delete cascade,
  label       text not null,
  worth       int not null,
  slot_group  int not null,
  result      text,
  sets        int,
  court_count int not null default 1,
  exact       boolean not null default true,
  partial     boolean not null default false,
  sort_order  int not null,
  unique (fixture_id, sort_order)
);

create table if not exists public.team_fixture_slot_players (
  slot_id   uuid not null references public.team_fixture_slots(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (slot_id, player_id)
);

create index if not exists team_memberships_player_idx
  on public.team_memberships (player_id);
create index if not exists team_fixture_slot_players_player_idx
  on public.team_fixture_slot_players (player_id);
create index if not exists team_fixtures_season_idx
  on public.team_fixtures (team_season_id, sort_order);

alter table public.teams                     enable row level security;
alter table public.team_seasons              enable row level security;
alter table public.team_memberships          enable row level security;
alter table public.team_fixtures             enable row level security;
alter table public.team_fixture_slots        enable row level security;
alter table public.team_fixture_slot_players enable row level security;

create policy teams_read              on public.teams                     for select using (true);
create policy team_seasons_read       on public.team_seasons              for select using (true);
create policy team_memberships_read   on public.team_memberships          for select using (true);
create policy team_fixtures_read      on public.team_fixtures             for select using (true);
create policy team_slots_read         on public.team_fixture_slots        for select using (true);
create policy team_slot_players_read  on public.team_fixture_slot_players for select using (true);
```

- [ ] **Step 2: Aplicar a migração**

O repo tem drift de migrations — **não** use `supabase db push`.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260909120000_amateur_profiles_teams.sql`
Expected: sai sem erro (o script imprime a verificação de coluna só quando recebe um segundo argumento; aqui basta não lançar).

- [ ] **Step 3: Verificar que as tabelas existem**

```bash
node -e "
const {Pool}=require('pg');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const u=new URL(process.env.DATABASE_URL);
const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
p.query(\"select table_name from information_schema.tables where table_schema='public' and table_name like 'team%' order by 1\").then(r=>{console.log(r.rows.map(x=>x.table_name));return p.end()});
"
```

Expected: `[ 'team_fixture_slot_players', 'team_fixture_slots', 'team_fixtures', 'team_memberships', 'team_seasons', 'teams' ]`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909120000_amateur_profiles_teams.sql
git commit -m "feat(amateur): schema for amateur tier and team model"
```

---

## Task 2: Helper de tier

**Files:**
- Create: `src/lib/player-tier.ts`
- Test: `src/lib/__tests__/player-tier.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/player-tier.test.ts
import { describe, it, expect } from 'vitest'
import { PLAYER_TIERS, isProTier, isAmateurTier, type PlayerTier } from '../player-tier'

describe('player-tier', () => {
  it('exposes exactly the two known tiers', () => {
    expect(PLAYER_TIERS).toEqual(['pro', 'amateur'])
  })

  it('treats a null or missing tier as pro', () => {
    expect(isProTier(null)).toBe(true)
    expect(isProTier(undefined)).toBe(true)
  })

  it('classifies known tiers', () => {
    expect(isProTier('pro')).toBe(true)
    expect(isProTier('amateur')).toBe(false)
    expect(isAmateurTier('amateur')).toBe(true)
    expect(isAmateurTier(null)).toBe(false)
  })

  it('treats an unknown tier string as non-amateur', () => {
    const unknown = 'legend' as PlayerTier
    expect(isAmateurTier(unknown)).toBe(false)
    expect(isProTier(unknown)).toBe(false)
  })
})
```

Legacy rows gravadas antes da migração podem chegar com `tier` ausente no payload de um `select` parcial; por isso `null`/`undefined` conta como pro. Uma string desconhecida não é nem pro nem amador — falha fechada nos dois sentidos, para que um tier futuro nunca vaze silenciosamente para dentro do produto profissional.

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/__tests__/player-tier.test.ts`
Expected: FAIL — `Failed to resolve import "../player-tier"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/player-tier.ts
// Single source of truth for the pro/amateur split on public.players.
//
// Amateurs live in the same table as professionals (see the 2026-09-09
// amateur-profiles spec). The isolation that keeps them out of the pro
// product is enforced here and at the three call sites documented in the
// spec — most importantly PlayerResolver, which must never match one.

export const PLAYER_TIERS = ['pro', 'amateur'] as const
export type PlayerTier = (typeof PLAYER_TIERS)[number]

/** Column name, so query builders never hardcode the string. */
export const TIER_COLUMN = 'tier'
export const AMATEUR_TIER: PlayerTier = 'amateur'
export const PRO_TIER: PlayerTier = 'pro'

/**
 * True when the row belongs to the professional product. A null/undefined
 * tier means the column wasn't selected or predates the migration — those
 * rows are professionals.
 */
export function isProTier(tier: string | null | undefined): boolean {
  return tier == null || tier === PRO_TIER
}

/** True only for an explicit amateur row. */
export function isAmateurTier(tier: string | null | undefined): boolean {
  return tier === AMATEUR_TIER
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/__tests__/player-tier.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-tier.ts src/lib/__tests__/player-tier.test.ts
git commit -m "feat(amateur): add player-tier helper"
```

---

## Task 3: Guard no PlayerResolver

O `PlayerResolver` carrega **todos** os jogadores num cache em memória (`src/lib/player-resolver.ts:242`) e resolve os 5 tiers contra esse cache. Excluir amadores no carregamento fecha todos os caminhos de uma vez — fip_id, external_id, nome normalizado, fuzzy e alias.

**Files:**
- Modify: `src/lib/player-resolver.ts:242-244`
- Test: `src/lib/__tests__/player-resolver-amateur.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/player-resolver-amateur.test.ts
// The resolver must never consider an amateur row as a match candidate.
// A club player sharing a name with a FIP professional is the failure
// mode this guards against.
import { describe, it, expect, vi } from 'vitest'
import { PlayerResolver } from '../player-resolver'

/** Records the filters applied to the players cache-loading select. */
function makeSupabaseSpy() {
  const applied: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  const chain = (method: string) => (...args: unknown[]) => {
    applied.push({ method, args })
    return builder
  }
  builder.select = chain('select')
  builder.neq = chain('neq')
  builder.eq = chain('eq')
  builder.range = (...args: unknown[]) => {
    applied.push({ method: 'range', args })
    return Promise.resolve({ data: [], error: null })
  }
  const supabase = { from: vi.fn(() => builder) }
  return { supabase, applied }
}

describe('PlayerResolver amateur isolation', () => {
  it('excludes amateur rows when loading the resolution cache', async () => {
    const { supabase, applied } = makeSupabaseSpy()
    const resolver = new PlayerResolver(supabase as never)

    await resolver.loadCache()

    const neqCalls = applied.filter(a => a.method === 'neq')
    expect(neqCalls).toHaveLength(1)
    expect(neqCalls[0].args).toEqual(['tier', 'amateur'])
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/__tests__/player-resolver-amateur.test.ts`
Expected: FAIL — `expected [] to have a length of 1 but got +0`

Se falhar com `resolver.loadCache is not a function`, abra `src/lib/player-resolver.ts` e use o nome real do método que contém o `while (true)` de paginação na linha ~241; ajuste a chamada do teste para esse nome antes de seguir.

- [ ] **Step 3: Aplicar o guard**

Em `src/lib/player-resolver.ts`, no select de carregamento do cache (~linha 242), acrescente o `.neq()` e o comentário:

```ts
      const { data, error } = await this.supabase
        .from('players')
        .select('id, external_id, fip_id, name, normalized_name, country, category, ranking, points')
        // Amateur profiles share this table but are never resolution
        // candidates — a club player named "Juan Rivas" must not be matched
        // onto the FIP professional of the same name. Excluding them from
        // the cache closes all five resolution tiers at once.
        .neq('tier', 'amateur')
        .range(offset, offset + PAGE_SIZE - 1)
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/__tests__/player-resolver-amateur.test.ts`
Expected: PASS — 1 test

- [ ] **Step 5: Rodar a suíte do resolver para garantir que nada quebrou**

Run: `npx vitest run src/lib/__tests__/player-resolver.test.ts`
Expected: PASS — todos os testes existentes continuam verdes

- [ ] **Step 6: Commit**

```bash
git add src/lib/player-resolver.ts src/lib/__tests__/player-resolver-amateur.test.ts
git commit -m "fix(resolver): never match amateur rows as resolution candidates"
```

---

## Task 4: Sitemap inclui amadores e respeita hidden

Amadores são públicos como os pros (decisão do operador). O filtro atual (`ranking not null OR total_matches > 0`) os excluiria, porque nenhum amador tem ranking FIP nem `total_matches`.

**Files:**
- Modify: `src/app/sitemap-players.xml/route.ts:26-31`

- [ ] **Step 1: Ajustar a query**

```ts
  const { data, error } = await supabase
    .from('players')
    .select('id')
    // Amateurs have neither a FIP ranking nor total_matches, so they need an
    // explicit clause to make the cut. `hidden` is the takedown switch: a
    // player who asks to be removed drops out of the crawl with one UPDATE.
    .or('ranking.not.is.null,total_matches.gt.0,tier.eq.amateur')
    .eq('hidden', false)
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(PLAYER_LIMIT)
```

- [ ] **Step 2: Verificar que a rota compila e responde**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep sitemap-players || echo "sem erros de tipo nessa rota"`
Expected: `sem erros de tipo nessa rota`

- [ ] **Step 3: Commit**

```bash
git add src/app/sitemap-players.xml/route.ts
git commit -m "feat(seo): include amateur profiles in the player sitemap"
```

---

## Task 5: Extrair `Last10SparkBar` para `Widget.tsx`

Hoje ele vive em `page.tsx:63-132`. Os dois perfis precisam da mesma barra, então ele desce para o módulo de widgets compartilhados. Extração pura — nenhuma mudança de comportamento.

**Files:**
- Modify: `src/app/[locale]/player/[id]/Widget.tsx`
- Modify: `src/app/[locale]/player/[id]/page.tsx:63-132` (remover), `:1201` (passa a importar)

- [ ] **Step 1: Adicionar o componente em `Widget.tsx`**

No topo do arquivo, junto às constantes existentes, acrescente o import e o componente. `Widget.tsx` já é `'use client'`.

```tsx
import { useRef } from 'react'
import { useInViewOnce } from '@/hooks/useInViewOnce'
```

E, depois de `WidgetIcon`:

```tsx
// Last-N sparkline single bar (vertical, grows from bottom).
// Each bar owns its IntersectionObserver via useInViewOnce so the row
// staggers as it scrolls into view. Shared by the pro and amateur profiles.
export function Last10SparkBar({
  won,
  isLatest,
  rowIndex,
  onClick,
  title,
  green,
  red,
  orange,
}: {
  won: boolean
  isLatest: boolean
  rowIndex: number
  onClick: (e: React.MouseEvent) => void
  title: string
  green: string
  red: string
  orange: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(barRef)
  return (
    <div
      ref={barRef}
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        position: 'relative',
        height: won ? '100%' : '50%',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: won
            ? `linear-gradient(to top, ${green}, rgba(126,211,33,0.4))`
            : `linear-gradient(to top, ${red}, rgba(255,70,85,0.3))`,
          clipPath: 'polygon(0% 12%, 100% 0%, 100% 100%, 0% 100%)',
          outline: isLatest ? `1.5px solid ${orange}` : 'none',
          outlineOffset: isLatest ? 1 : 0,
          transformOrigin: 'bottom center',
          transform: inView ? 'scaleY(1)' : 'scaleY(0)',
          transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
        }}
      />
      {isLatest && (
        <div
          style={{
            position: 'absolute',
            top: -7,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 7,
            fontWeight: 800,
            color: orange,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}
        >
          ▼
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remover a cópia local de `page.tsx`**

Apague o bloco `function Last10SparkBar({...}) { ... }` de `page.tsx` (o comentário `// Last 10 sparkline single bar` até o `}` de fechamento, ~linhas 62-132) e troque o import de `Widget`:

```tsx
import { Widget, WidgetIcon, Last10SparkBar } from './Widget'
```

- [ ] **Step 3: Verificar tipos e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros. Se o lint reclamar de `useRef`/`useInViewOnce` não usados em `page.tsx`, remova-os dos imports **apenas se** nenhum outro trecho do arquivo os usar — confirme com `grep -n "useInViewOnce\|useRef" "src/app/[locale]/player/[id]/page.tsx"` antes de apagar.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/Widget.tsx" "src/app/[locale]/player/[id]/page.tsx"
git commit -m "refactor(player): move Last10SparkBar into the shared Widget module"
```

---

## Task 6: Derivações puras do perfil amador

Funções sem I/O, testadas isoladamente. Elas carregam a honestidade dos dados: parceiro só é "exato" quando a pista é única no bloco.

**Files:**
- Create: `src/lib/amateur-derive.ts`
- Test: `src/lib/__tests__/amateur-derive.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/amateur-derive.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeRecord,
  computeUsualCourt,
  collectPartners,
  type AmateurGame,
} from '../amateur-derive'

const PLAYER = 'p-gustavo'

/** Gustavo's real 25/26 record: 2-5 across 7 games, 6 of them on a 3-point court. */
const GAMES: AmateurGame[] = [
  { fixtureCode: 'J2',   worth: 3, result: 'L', sets: 2, exact: false, complete: true,  partnerIds: ['p-albert', 'p-jonatan', 'p-william'] },
  { fixtureCode: 'J3',   worth: 2, result: 'W', sets: 3, exact: true,  complete: true,  partnerIds: ['p-gerard'] },
  { fixtureCode: 'J4',   worth: 3, result: 'L', sets: 3, exact: true,  complete: true,  partnerIds: ['p-sergio'] },
  { fixtureCode: 'J7',   worth: 3, result: 'W', sets: 3, exact: false, complete: true,  partnerIds: ['p-albert', 'p-david', 'p-gerard'] },
  { fixtureCode: 'J9',   worth: 3, result: 'L', sets: 2, exact: false, complete: true,  partnerIds: ['p-eric', 'p-gerard', 'p-valentin'] },
  { fixtureCode: 'J10',  worth: 3, result: 'L', sets: 2, exact: false, complete: false, partnerIds: [] },
  { fixtureCode: 'POFF', worth: 3, result: 'L', sets: 2, exact: false, complete: false, partnerIds: ['p-albert', 'p-david'] },
]

describe('computeRecord', () => {
  it('counts every game, including the partial ones', () => {
    expect(computeRecord(GAMES)).toEqual({ played: 7, wins: 2, losses: 5, winRate: 29 })
  })

  it('returns a zero record with a null win rate when there are no games', () => {
    expect(computeRecord([])).toEqual({ played: 0, wins: 0, losses: 0, winRate: null })
  })
})

describe('computeUsualCourt', () => {
  it('reports the dominant court block and how often it was used', () => {
    expect(computeUsualCourt(GAMES)).toEqual({ worth: 3, count: 6, total: 7 })
  })

  it('breaks a tie in favour of the higher-value court', () => {
    const tied: AmateurGame[] = [
      { fixtureCode: 'J1', worth: 3, result: 'W', sets: 2, exact: true, complete: true, partnerIds: [] },
      { fixtureCode: 'J2', worth: 2, result: 'L', sets: 2, exact: true, complete: true, partnerIds: [] },
    ]
    expect(computeUsualCourt(tied)).toEqual({ worth: 3, count: 1, total: 2 })
  })

  it('returns null when there are no games', () => {
    expect(computeUsualCourt([])).toBeNull()
  })
})

describe('collectPartners', () => {
  it('separates confirmed partners from probable ones', () => {
    const { confirmed, probable } = collectPartners(GAMES)
    expect(confirmed).toEqual(['p-gerard', 'p-sergio'])
    expect(probable).toEqual(
      expect.arrayContaining(['p-albert', 'p-david', 'p-eric', 'p-jonatan', 'p-valentin', 'p-william']),
    )
  })

  it('never lists the same player as both confirmed and probable', () => {
    const { confirmed, probable } = collectPartners(GAMES)
    // p-gerard appears in an ambiguous J7/J9 slot too, but a confirmed
    // pairing in J3 outranks it — a known partner must not be downgraded.
    expect(probable).not.toContain('p-gerard')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/__tests__/amateur-derive.test.ts`
Expected: FAIL — `Failed to resolve import "../amateur-derive"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/amateur-derive.ts
// Pure derivations for the amateur profile.
//
// The SNP source gives us, per court: who was on it, whether it was won,
// and how many sets it lasted — but not the opponent, not a set score, and
// not always which two of the listed players actually partnered. Anything
// derived here has to survive that: a partner is only "confirmed" when the
// slot held exactly one court.

export interface AmateurGame {
  fixtureCode: string
  /** Court block value: 3 = courts 1-2, 2 = courts 3-5. */
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  /** True when the slot maps to a single court, so the pairing is certain. */
  exact: boolean
  /** False for partially-recorded rounds (J10, playoff) — still counted. */
  complete: boolean
  /** Everyone else listed on the slot, excluding the profile's own player. */
  partnerIds: string[]
}

export interface AmateurRecord {
  played: number
  wins: number
  losses: number
  /** Whole-number percentage, or null when no games were played. */
  winRate: number | null
}

export function computeRecord(games: AmateurGame[]): AmateurRecord {
  const played = games.length
  const wins = games.filter(g => g.result === 'W').length
  const losses = games.filter(g => g.result === 'L').length
  return {
    played,
    wins,
    losses,
    winRate: played > 0 ? Math.round((wins / played) * 100) : null,
  }
}

export interface UsualCourt {
  worth: number
  count: number
  total: number
}

/**
 * The court block the player was fielded on most. Ties go to the higher-value
 * block, because being trusted on a 3-point court is the more notable fact.
 */
export function computeUsualCourt(games: AmateurGame[]): UsualCourt | null {
  if (games.length === 0) return null
  const counts = new Map<number, number>()
  for (const g of games) counts.set(g.worth, (counts.get(g.worth) ?? 0) + 1)
  let best: UsualCourt | null = null
  for (const [worth, count] of counts) {
    if (best == null || count > best.count || (count === best.count && worth > best.worth)) {
      best = { worth, count, total: games.length }
    }
  }
  return best
}

export interface AmateurPartners {
  /** Sorted player ids we know the player partnered with. */
  confirmed: string[]
  /** Sorted player ids who *may* have partnered — ambiguous slots only. */
  probable: string[]
}

export function collectPartners(games: AmateurGame[]): AmateurPartners {
  const confirmed = new Set<string>()
  const maybe = new Set<string>()
  for (const g of games) {
    for (const id of g.partnerIds) {
      if (g.exact && g.partnerIds.length === 1) confirmed.add(id)
      else maybe.add(id)
    }
  }
  // A confirmed pairing outranks an ambiguous appearance elsewhere.
  for (const id of confirmed) maybe.delete(id)
  return {
    confirmed: [...confirmed].sort(),
    probable: [...maybe].sort(),
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/__tests__/amateur-derive.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-derive.ts src/lib/__tests__/amateur-derive.test.ts
git commit -m "feat(amateur): pure derivations for record, usual court and partners"
```

---

## Task 7: Fetch e montagem do `AmateurProfileData`

Uma função que, dado um `playerId`, devolve tudo que as três abas precisam: equipe, temporada, elenco, jornadas, pistas e os jogos do próprio jogador.

**Files:**
- Create: `src/lib/amateur-profile.ts`
- Test: `src/lib/__tests__/amateur-profile.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

O teste cobre `buildAmateurProfile`, que é pura: recebe as linhas cruas já buscadas e monta a estrutura. O `fetchAmateurProfile` (I/O) é fino e fica coberto pela verificação manual da Task 13.

```ts
// src/lib/__tests__/amateur-profile.test.ts
import { describe, it, expect } from 'vitest'
import { buildAmateurProfile, type AmateurRawRows } from '../amateur-profile'

const PLAYER_ID = 'p-gustavo'

const RAW: AmateurRawRows = {
  membership: {
    team_season_id: 'ts-1',
    player_id: PLAYER_ID,
    competition_points: 41250,
    competition_rank: 412,
    roster_rank: 9,
    games_played: 7,
    wins: 2,
    losses: 5,
  },
  season: {
    id: 'ts-1',
    team_id: 't-1',
    label: '25/26',
    ranking: 7,
    ties_played: 9,
    ties_won: 3,
    courts_won: 20,
    courts_lost: 25,
    points_for: 46,
    points_against: 62,
    notes: 'Reconstruído do ranking por jornadas da SNP.',
  },
  team: {
    id: 't-1',
    slug: 'blue-padel-mataro',
    name: 'Blue Padel Mataró',
    club: 'Blue Padel',
    city: 'Mataró',
    country: 'ES',
    crest_url: null,
    competition: 'Series Nacionales de Pádel · Barcelona · Masculino 1000',
    category: 'men',
  },
  roster: [
    { player_id: PLAYER_ID,  roster_rank: 9, games_played: 7, wins: 2, losses: 5, player: { id: PLAYER_ID,  name: 'Gustavo Denes',  avatar_url: null } },
    { player_id: 'p-abraham', roster_rank: 22, games_played: 0, wins: 0, losses: 0, player: { id: 'p-abraham', name: 'Abraham Torres', avatar_url: null } },
  ],
  fixtures: [
    { id: 'f-1', code: 'J2', label: 'Jornada 2', sort_order: 2, complete: true,  result: 'L', points_for: 0, points_against: 12, courts_won: 0, courts_lost: 5, opponent_name: null, played_on: null },
    { id: 'f-2', code: 'J3', label: 'Jornada 3', sort_order: 3, complete: true,  result: 'L', points_for: 5, points_against: 7,  courts_won: 2, courts_lost: 3, opponent_name: null, played_on: null },
    { id: 'f-3', code: 'POFF', label: 'Playoff', sort_order: 11, complete: false, result: null, points_for: null, points_against: null, courts_won: null, courts_lost: null, opponent_name: null, played_on: null },
  ],
  slots: [
    { id: 's-1', fixture_id: 'f-1', label: 'Pistas 1 y 2', worth: 3, slot_group: 3, result: 'L', sets: 2, court_count: 2, exact: false, partial: false, sort_order: 1, player_ids: [PLAYER_ID, 'p-albert', 'p-jonatan', 'p-william'] },
    { id: 's-2', fixture_id: 'f-2', label: 'Pista 3',      worth: 2, slot_group: 2, result: 'W', sets: 3, court_count: 1, exact: true,  partial: false, sort_order: 3, player_ids: [PLAYER_ID, 'p-gerard'] },
    { id: 's-3', fixture_id: 'f-2', label: 'Pista 4',      worth: 2, slot_group: 2, result: 'L', sets: 2, court_count: 1, exact: true,  partial: false, sort_order: 4, player_ids: ['p-hugo', 'p-pol'] },
    { id: 's-4', fixture_id: 'f-3', label: 'Pista 1',      worth: 3, slot_group: 3, result: 'L', sets: 2, court_count: 1, exact: false, partial: true,  sort_order: 1, player_ids: [PLAYER_ID, 'p-albert', 'p-david'] },
  ],
}

describe('buildAmateurProfile', () => {
  const profile = buildAmateurProfile(PLAYER_ID, RAW)

  it('carries team and season identity through', () => {
    expect(profile.team.name).toBe('Blue Padel Mataró')
    expect(profile.season.label).toBe('25/26')
    expect(profile.season.ranking).toBe(7)
  })

  it('keeps only the slots the player was on, ordered by fixture', () => {
    expect(profile.games.map(g => g.fixtureCode)).toEqual(['J2', 'J3', 'POFF'])
  })

  it('excludes the player themselves from their own partner list', () => {
    const j3 = profile.games.find(g => g.fixtureCode === 'J3')!
    expect(j3.partnerIds).toEqual(['p-gerard'])
  })

  it('marks a multi-court slot as inexact', () => {
    const j2 = profile.games.find(g => g.fixtureCode === 'J2')!
    expect(j2.exact).toBe(false)
    expect(j2.partnerIds).toHaveLength(3)
  })

  it('flags games from partially-recorded fixtures', () => {
    const poff = profile.games.find(g => g.fixtureCode === 'POFF')!
    expect(poff.complete).toBe(false)
  })

  it('derives the record, usual court and partners', () => {
    expect(profile.record).toEqual({ played: 3, wins: 1, losses: 2, winRate: 33 })
    expect(profile.usualCourt).toEqual({ worth: 3, count: 2, total: 3 })
    expect(profile.partners.confirmed).toEqual(['p-gerard'])
  })

  it('keeps roster members who never played', () => {
    const abraham = profile.roster.find(r => r.playerId === 'p-abraham')!
    expect(abraham.gamesPlayed).toBe(0)
  })

  it('groups every slot under its fixture for the team tab', () => {
    const j3 = profile.fixtures.find(f => f.code === 'J3')!
    expect(j3.slots.map(s => s.label)).toEqual(['Pista 3', 'Pista 4'])
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/__tests__/amateur-profile.test.ts`
Expected: FAIL — `Failed to resolve import "../amateur-profile"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/amateur-profile.ts
// Assembles everything the amateur profile page renders, from the team model
// introduced by the 2026-09-09 spec.
//
// Split in two on purpose: fetchAmateurProfile does the I/O, buildAmateurProfile
// is pure and holds every shaping decision, so the interesting logic is testable
// without a database.

import { supabase } from '@/lib/supabase'
import {
  computeRecord,
  computeUsualCourt,
  collectPartners,
  type AmateurGame,
  type AmateurRecord,
  type UsualCourt,
  type AmateurPartners,
} from '@/lib/amateur-derive'

export interface AmateurRawRows {
  membership: {
    team_season_id: string
    player_id: string
    competition_points: number | null
    competition_rank: number | null
    roster_rank: number | null
    games_played: number | null
    wins: number | null
    losses: number | null
  }
  season: {
    id: string
    team_id: string
    label: string
    ranking: number | null
    ties_played: number | null
    ties_won: number | null
    courts_won: number | null
    courts_lost: number | null
    points_for: number | null
    points_against: number | null
    notes: string | null
  }
  team: {
    id: string
    slug: string
    name: string
    club: string | null
    city: string | null
    country: string | null
    crest_url: string | null
    competition: string | null
    category: string | null
  }
  roster: Array<{
    player_id: string
    roster_rank: number | null
    games_played: number | null
    wins: number | null
    losses: number | null
    player: { id: string; name: string; avatar_url: string | null } | null
  }>
  fixtures: Array<{
    id: string
    code: string
    label: string
    sort_order: number
    complete: boolean
    result: string | null
    points_for: number | null
    points_against: number | null
    courts_won: number | null
    courts_lost: number | null
    opponent_name: string | null
    played_on: string | null
  }>
  slots: Array<{
    id: string
    fixture_id: string
    label: string
    worth: number
    slot_group: number
    result: string | null
    sets: number | null
    court_count: number
    exact: boolean
    partial: boolean
    sort_order: number
    player_ids: string[]
  }>
}

export interface AmateurSlot {
  id: string
  label: string
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  exact: boolean
  partial: boolean
  courtCount: number
  playerIds: string[]
}

export interface AmateurFixture {
  id: string
  code: string
  label: string
  complete: boolean
  result: 'W' | 'L' | null
  pointsFor: number | null
  pointsAgainst: number | null
  courtsWon: number | null
  courtsLost: number | null
  opponentName: string | null
  slots: AmateurSlot[]
}

export interface AmateurRosterEntry {
  playerId: string
  name: string
  avatarUrl: string | null
  rosterRank: number | null
  gamesPlayed: number
  wins: number
  losses: number
}

export interface AmateurProfileData {
  team: AmateurRawRows['team']
  season: AmateurRawRows['season']
  competitionPoints: number | null
  competitionRank: number | null
  rosterRank: number | null
  games: AmateurGame[]
  fixtures: AmateurFixture[]
  roster: AmateurRosterEntry[]
  record: AmateurRecord
  usualCourt: UsualCourt | null
  partners: AmateurPartners
}

function asResult(value: string | null): 'W' | 'L' | null {
  return value === 'W' || value === 'L' ? value : null
}

export function buildAmateurProfile(playerId: string, raw: AmateurRawRows): AmateurProfileData {
  const fixtureByOrder = new Map(raw.fixtures.map(f => [f.id, f]))
  const orderedFixtures = [...raw.fixtures].sort((a, b) => a.sort_order - b.sort_order)

  const fixtures: AmateurFixture[] = orderedFixtures.map(f => ({
    id: f.id,
    code: f.code,
    label: f.label,
    complete: f.complete,
    result: asResult(f.result),
    pointsFor: f.points_for,
    pointsAgainst: f.points_against,
    courtsWon: f.courts_won,
    courtsLost: f.courts_lost,
    opponentName: f.opponent_name,
    slots: raw.slots
      .filter(s => s.fixture_id === f.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => ({
        id: s.id,
        label: s.label,
        worth: s.worth,
        result: asResult(s.result),
        sets: s.sets,
        // A slot covering more than one court can never pin the pairing down,
        // whatever the import wrote into `exact`.
        exact: s.exact && s.court_count === 1,
        partial: s.partial,
        courtCount: s.court_count,
        playerIds: s.player_ids,
      })),
  }))

  const games: AmateurGame[] = raw.slots
    .filter(s => s.player_ids.includes(playerId))
    .sort((a, b) => {
      const fa = fixtureByOrder.get(a.fixture_id)?.sort_order ?? 0
      const fb = fixtureByOrder.get(b.fixture_id)?.sort_order ?? 0
      return fa - fb || a.sort_order - b.sort_order
    })
    .map(s => ({
      fixtureCode: fixtureByOrder.get(s.fixture_id)?.code ?? '',
      worth: s.worth,
      result: asResult(s.result),
      sets: s.sets,
      exact: s.exact && s.court_count === 1,
      complete: fixtureByOrder.get(s.fixture_id)?.complete ?? true,
      partnerIds: s.player_ids.filter(id => id !== playerId),
    }))

  const roster: AmateurRosterEntry[] = raw.roster
    .filter(r => r.player != null)
    .map(r => ({
      playerId: r.player_id,
      name: r.player!.name,
      avatarUrl: r.player!.avatar_url,
      rosterRank: r.roster_rank,
      gamesPlayed: r.games_played ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
    }))
    .sort((a, b) => (a.rosterRank ?? 999) - (b.rosterRank ?? 999))

  return {
    team: raw.team,
    season: raw.season,
    competitionPoints: raw.membership.competition_points,
    competitionRank: raw.membership.competition_rank,
    rosterRank: raw.membership.roster_rank,
    games,
    fixtures,
    roster,
    record: computeRecord(games),
    usualCourt: computeUsualCourt(games),
    partners: collectPartners(games),
  }
}

/**
 * Loads the player's most recent team season. Returns null when the player
 * has no membership — an amateur row with no season still renders a profile,
 * just without the team sections.
 */
export async function fetchAmateurProfile(playerId: string): Promise<AmateurProfileData | null> {
  const { data: membership } = await supabase
    .from('team_memberships')
    .select('team_season_id, player_id, competition_points, competition_rank, roster_rank, games_played, wins, losses')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!membership) return null

  const { data: season } = await supabase
    .from('team_seasons')
    .select('id, team_id, label, ranking, ties_played, ties_won, courts_won, courts_lost, points_for, points_against, notes')
    .eq('id', membership.team_season_id)
    .single()
  if (!season) return null

  const { data: team } = await supabase
    .from('teams')
    .select('id, slug, name, club, city, country, crest_url, competition, category')
    .eq('id', season.team_id)
    .single()
  if (!team) return null

  const { data: roster } = await supabase
    .from('team_memberships')
    .select('player_id, roster_rank, games_played, wins, losses, player:players(id, name, avatar_url)')
    .eq('team_season_id', season.id)

  const { data: fixtures } = await supabase
    .from('team_fixtures')
    .select('id, code, label, sort_order, complete, result, points_for, points_against, courts_won, courts_lost, opponent_name, played_on')
    .eq('team_season_id', season.id)
    .order('sort_order')

  const fixtureIds = (fixtures ?? []).map(f => f.id)
  const { data: slots } = fixtureIds.length
    ? await supabase
        .from('team_fixture_slots')
        .select('id, fixture_id, label, worth, slot_group, result, sets, court_count, exact, partial, sort_order, players:team_fixture_slot_players(player_id)')
        .in('fixture_id', fixtureIds)
    : { data: [] as Array<Record<string, unknown>> }

  const normalizedSlots = (slots ?? []).map(s => {
    const row = s as unknown as AmateurRawRows['slots'][number] & {
      players: Array<{ player_id: string }> | null
    }
    return { ...row, player_ids: (row.players ?? []).map(p => p.player_id) }
  })

  return buildAmateurProfile(playerId, {
    membership,
    season,
    team,
    roster: (roster ?? []) as AmateurRawRows['roster'],
    fixtures: (fixtures ?? []) as AmateurRawRows['fixtures'],
    slots: normalizedSlots as AmateurRawRows['slots'],
  })
}
```

Nenhuma dessas leituras é paginada de propósito: todas são limitadas pelo tamanho de uma temporada de equipe (24 jogadores, ~11 jornadas, ~55 pistas), muito abaixo do teto de 10k do PostgREST. Ver a política em `CLAUDE.md`.

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/__tests__/amateur-profile.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-profile.ts src/lib/__tests__/amateur-profile.test.ts
git commit -m "feat(amateur): assemble profile data from the team model"
```

---

## Task 8: i18n

As strings precisam existir antes dos componentes, senão o `useTranslations` explode em runtime durante o desenvolvimento das próximas tasks.

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json`

- [ ] **Step 1: Adicionar o bloco `amateur` no `en.json`**

Insira no nível raiz do objeto, ao lado dos outros namespaces:

```json
  "amateur": {
    "badge": "Amateur",
    "games": "Games",
    "record": "Record",
    "competitionRank": "{competition} rank",
    "competitionPoints": "{competition} points",
    "position": "Position",
    "sideDrive": "Drive",
    "sideBackhand": "Backhand",
    "team": "Team",
    "teamRank": "#{rank} in {competition}",
    "tabSummary": "Summary",
    "tabSeason": "Season",
    "tabTeam": "Team",
    "lastGames": "Last {count} games",
    "lastGamesHint": "{record} this season · taller bar = went to three sets",
    "usualCourt": "Usual court",
    "usualCourtValue": "Courts {block}",
    "usualCourtHint": "{count} of {total} · worth {worth} points",
    "winRate": "Win rate",
    "rosterRank": "{rank} in the squad",
    "partners": "Partners",
    "partnersProbable": "+{count} probable",
    "suggestPrompt": "Something wrong?",
    "suggestCta": "Suggest a change",
    "roundColumn": "Round",
    "courtColumn": "Court",
    "resultColumn": "Result",
    "setsColumn": "Duration",
    "won": "Won",
    "lost": "Lost",
    "setsValue": "{count} sets",
    "partialRound": "Partial record",
    "partialRoundHint": "Only part of the line-up could be confirmed, so no score is shown.",
    "ambiguousPairing": "Same result on {count} courts — the exact pairing isn't recorded.",
    "squad": "Squad",
    "squadNoGames": "no games",
    "squadLine": "{games} games · {wins}–{losses}",
    "noSeason": "No season recorded yet.",
    "methodNote": "Method and limitations"
  },
```

- [ ] **Step 2: Traduzir o mesmo bloco nos outros quatro arquivos**

`es.json`, `pt.json`, `it.json`, `fr.json` recebem o mesmo conjunto de chaves com os valores traduzidos. Nomes de equipe e de competição vêm do banco e não são traduzidos.

Referência para `pt.json`:

```json
  "amateur": {
    "badge": "Amador",
    "games": "Jogos",
    "record": "Balanço",
    "competitionRank": "Ranking {competition}",
    "competitionPoints": "Pontos {competition}",
    "position": "Posição",
    "sideDrive": "Drive",
    "sideBackhand": "Revés",
    "team": "Equipe",
    "teamRank": "#{rank} no {competition}",
    "tabSummary": "Resumo",
    "tabSeason": "Temporada",
    "tabTeam": "Equipe",
    "lastGames": "Últimos {count} jogos",
    "lastGamesHint": "{record} na temporada · barra alta = foi a três sets",
    "usualCourt": "Pista habitual",
    "usualCourtValue": "Pistas {block}",
    "usualCourtHint": "{count} de {total} · vale {worth} pontos",
    "winRate": "Aproveitamento",
    "rosterRank": "{rank} do elenco",
    "partners": "Parceiros",
    "partnersProbable": "+{count} prováveis",
    "suggestPrompt": "Algum dado errado?",
    "suggestCta": "Sugerir alteração",
    "roundColumn": "Jornada",
    "courtColumn": "Pista",
    "resultColumn": "Resultado",
    "setsColumn": "Duração",
    "won": "Ganha",
    "lost": "Perdida",
    "setsValue": "{count} sets",
    "partialRound": "Registro parcial",
    "partialRoundHint": "Só parte da escalação pôde ser confirmada, então o placar não é mostrado.",
    "ambiguousPairing": "Mesmo resultado em {count} pistas — a dupla exata não consta.",
    "squad": "Plantel",
    "squadNoGames": "sem jogos",
    "squadLine": "{games} jogos · {wins}–{losses}",
    "noSeason": "Nenhuma temporada registrada ainda.",
    "methodNote": "Método e limitações"
  },
```

- [ ] **Step 3: Verificar que os cinco arquivos são JSON válido e têm as mesmas chaves**

```bash
node -e "
const l=['en','es','pt','it','fr'].map(x=>[x,require('./src/messages/'+x+'.json').amateur]);
const base=Object.keys(l[0][1]).sort();
for(const [name,obj] of l){
  if(!obj){console.error(name,'missing amateur block');process.exit(1)}
  const k=Object.keys(obj).sort();
  if(JSON.stringify(k)!==JSON.stringify(base)){
    console.error(name,'key mismatch',{missing:base.filter(x=>!k.includes(x)),extra:k.filter(x=>!base.includes(x))});
    process.exit(1)
  }
}
console.log('all five locales carry the same', base.length, 'amateur keys');
"
```

Expected: `all five locales carry the same 34 amateur keys`

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "feat(amateur): i18n strings for the amateur profile"
```

---

## Task 9: Casca do `AmateurProfile` — header, hero e abas

**Files:**
- Create: `src/app/[locale]/player/[id]/AmateurProfile.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// src/app/[locale]/player/[id]/AmateurProfile.tsx
// Amateur player profile. Rendered by page.tsx when players.tier === 'amateur'.
//
// Deliberately a separate component from the pro profile: different tabs,
// different data source, and page.tsx is already 2,200 lines. Shares the
// visual language through the Widget module and the same brand constants.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import FollowButton from '@/components/FollowButton'
import { FlagImage } from '@/components/FlagImage'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import BottomNav from '@/components/nav/BottomNavV3'
import DetailPageSkeleton from '@/components/skeletons/DetailPageSkeleton'
import { titleCase } from '@/lib/title-case'
import { fetchAmateurProfile, type AmateurProfileData } from '@/lib/amateur-profile'
import { SummaryTab } from './amateur/SummaryTab'
import { AmateurSeasonTab } from './amateur/SeasonTab'
import { TeamTab } from './amateur/TeamTab'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

export type AmateurTab = 'summary' | 'season' | 'team'

export interface AmateurPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
  side: string | null
  home_club: string | null
  birthplace: string | null
  birthdate: string | null
  height: number | null
  hand: string | null
}

export default function AmateurProfile({ player }: { player: AmateurPlayer }) {
  const t = useTranslations('amateur')
  const tPlayer = useTranslations('player')
  const router = useRouter()
  const [data, setData] = useState<AmateurProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<AmateurTab>('summary')
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAmateurProfile(player.id)
      .then(result => { if (!cancelled) setData(result) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [player.id])

  const handleBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }

  if (loading) return <DetailPageSkeleton />

  const displayName = titleCase(player.display_name?.trim() || player.name)
  const competition = data?.team.competition ?? null
  // "Series Nacionales de Pádel · Barcelona · Masculino 1000" is too long for a
  // pill; the first segment carries enough identity.
  const competitionShort = competition ? competition.split('·')[0].trim() : null
  const sideLabel = player.side === 'drive'
    ? t('sideDrive')
    : player.side === 'backhand'
      ? t('sideBackhand')
      : '—'

  const chips: Array<{ label: string; value: string; accent?: 'green' | 'orange' }> = []
  if (data) {
    chips.push({ label: t('games'), value: String(data.record.played) })
    chips.push({ label: t('record'), value: `${data.record.wins}–${data.record.losses}`, accent: 'green' })
    if (data.competitionRank != null && competitionShort) {
      chips.push({
        label: t('competitionRank', { competition: competitionShort }),
        value: `#${data.competitionRank}`,
        accent: 'orange',
      })
    }
  }
  chips.push({ label: t('position'), value: sideLabel })

  const tabs: Array<{ id: AmateurTab; label: string }> = [
    { id: 'summary', label: t('tabSummary') },
    { id: 'season', label: t('tabSeason') },
    { id: 'team', label: t('tabTeam') },
  ]

  return (
    <>
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.5)', position: 'sticky', top: 0, zIndex: 10,
          background: BG_BASE, height: 62,
        }}>
          <button
            onClick={handleBack}
            style={{
              width: 36, height: 36, border: 'none', cursor: 'pointer', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED,
            }}
            aria-label="Go back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {tPlayer('playerProfile')}
          </div>
          <div style={{ width: 36 }} />
        </div>

        <div style={{
          padding: '18px 16px 14px',
          background: `radial-gradient(ellipse at top, rgba(126,211,33,0.1) 0%, transparent 65%)`,
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ flexShrink: 0 }}>
              {player.avatar_url && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={player.avatar_url}
                  alt={player.name}
                  onError={() => setImgError(true)}
                  style={{ width: 74, height: 74, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${ORANGE}` }}
                />
              ) : (
                <div style={{
                  width: 74, height: 74, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, color: '#000', fontWeight: 800, border: `3px solid ${ORANGE}`,
                }}>
                  {player.name?.[0]}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'inline-block', background: GREEN, color: '#173404',
                fontSize: 9, fontWeight: 800, padding: '3px 9px',
                clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {competitionShort ? `${t('badge')} · ${competitionShort}` : t('badge')}
              </span>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: '#fff' }}>{displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: MUTED, fontSize: 12 }}>
                {player.country && <FlagImage country={player.country} size={16} />}
                <span>{[player.home_club, data?.team.city].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
            <FollowButton type="player" targetId={player.id} variant="follow" />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            {chips.map(c => (
              <div key={c.label} style={{
                flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
                clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
              }}>
                <div style={{
                  fontSize: 16, fontWeight: 800, lineHeight: 1,
                  color: c.accent === 'orange' ? ORANGE : c.accent === 'green' ? GREEN : '#fff',
                  fontVariantNumeric: 'tabular-nums',
                }}>{c.value}</div>
                <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                  {c.label}
                </div>
              </div>
            ))}
          </div>

          {data && (
            <button
              onClick={() => setActiveTab('team')}
              style={{
                marginTop: 8, width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)',
                borderRadius: 6, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'inherit', color: 'inherit',
              }}
            >
              <div style={{ fontSize: 7, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
                {t('team')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {data.team.name}
                </div>
                <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[
                    data.season.ranking != null && competitionShort
                      ? t('teamRank', { rank: data.season.ranking, competition: competitionShort })
                      : null,
                    data.season.label,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          )}
        </div>

        {data == null ? (
          <div style={{ padding: '32px 16px', color: MUTED, fontSize: 13, textAlign: 'center' }}>
            {t('noSeason')}
          </div>
        ) : (
          <>
            <SlidingInkTabs<AmateurTab>
              tabs={tabs.map(x => ({ key: x.id, label: x.label }))}
              activeKey={activeTab}
              onChange={setActiveTab}
            />
            {activeTab === 'summary' && <SummaryTab player={player} data={data} />}
            {activeTab === 'season' && <AmateurSeasonTab data={data} />}
            {activeTab === 'team' && <TeamTab data={data} currentPlayerId={player.id} />}
          </>
        )}
      </div>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 2: Confirmar a assinatura do `SlidingInkTabs`**

Run: `grep -n "interface\|type Props\|tabs:\|activeKey\|onChange" src/components/SlidingInkTabs.tsx | head -20`
Expected: uma lista de props. Ajuste a chamada acima para a assinatura real (nomes de props e a forma de cada item de `tabs`) antes de seguir — o perfil pro em `page.tsx:929` é o exemplo canônico de uso.

- [ ] **Step 3: Commit (ainda não compila — as abas vêm nas próximas tasks)**

```bash
git add "src/app/[locale]/player/[id]/AmateurProfile.tsx"
git commit -m "feat(amateur): profile shell with hero and tabs"
```

---

## Task 10: Aba Resumo

**Files:**
- Create: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// src/app/[locale]/player/[id]/amateur/SummaryTab.tsx
// Widget grid for the amateur profile. Mirrors the pro Overview grid, minus
// everything the SNP source can't support (earnings, titles, per-point stats).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Widget, Last10SparkBar } from '../Widget'
import { SuggestChangesSheet } from '@/components/SuggestChangesSheet'
import type { AmateurProfileData } from '@/lib/amateur-profile'
import type { AmateurPlayer } from '../AmateurProfile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function SummaryTab({ player, data }: { player: AmateurPlayer; data: AmateurProfileData }) {
  const t = useTranslations('amateur')
  const [suggestOpen, setSuggestOpen] = useState(false)

  const { games, record, usualCourt, partners } = data
  const nameById = new Map(data.roster.map(r => [r.playerId, r.name]))
  const recordLabel = `${record.wins}–${record.losses}`

  return (
    <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

      {games.length > 0 && (
        <Widget label={t('lastGames', { count: games.length })} wide>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 52, marginTop: 4 }}>
            {games.map((g, i) => (
              <Last10SparkBar
                key={`${g.fixtureCode}-${i}`}
                won={g.result === 'W'}
                isLatest={i === games.length - 1}
                rowIndex={i}
                onClick={() => {}}
                title={`${g.fixtureCode} · ${g.result === 'W' ? t('won') : t('lost')}`}
                green={GREEN}
                red={RED}
                orange={ORANGE}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>
            <span>{games[0].fixtureCode}</span>
            <span>{games[games.length - 1].fixtureCode}</span>
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 5 }}>
            {t('lastGamesHint', { record: recordLabel })}
          </div>
        </Widget>
      )}

      <Widget label={t('position')}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
          {player.side === 'drive' ? t('sideDrive') : player.side === 'backhand' ? t('sideBackhand') : '—'}
        </div>
      </Widget>

      {usualCourt && (
        <Widget label={t('usualCourt')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
            {t('usualCourtValue', { block: usualCourt.worth === 3 ? '1–2' : '3–5' })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('usualCourtHint', { count: usualCourt.count, total: usualCourt.total, worth: usualCourt.worth })}
          </div>
        </Widget>
      )}

      {record.winRate != null && (
        <Widget label={t('winRate')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {record.winRate}%
          </div>
          <div style={{ height: 4, background: '#242424', marginTop: 6 }}>
            <div style={{ width: `${record.winRate}%`, height: 4, background: GREEN }} />
          </div>
        </Widget>
      )}

      {data.competitionPoints != null && (
        <Widget label={t('competitionPoints', { competition: data.team.competition?.split('·')[0].trim() ?? '' })}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {Number(data.competitionPoints).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
          </div>
          {data.rosterRank != null && (
            <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
              {t('rosterRank', { rank: `${data.rosterRank}º` })}
            </div>
          )}
        </Widget>
      )}

      {(partners.confirmed.length > 0 || partners.probable.length > 0) && (
        <Widget label={t('partners')} wide>
          <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
            {partners.confirmed.map(id => (
              <span key={id} style={{ border: '1px solid #2A2A2A', padding: '3px 7px', fontSize: 10, color: '#fff' }}>
                {nameById.get(id) ?? id}
              </span>
            ))}
            {partners.probable.length > 0 && (
              <span style={{ border: '1px solid #2A2A2A', padding: '3px 7px', fontSize: 10, color: MUTED }}>
                {t('partnersProbable', { count: partners.probable.length })}
              </span>
            )}
          </div>
        </Widget>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, border: '1px dashed #2A2A2A', padding: '9px 10px' }}>
        <div style={{ flex: 1, fontSize: 10, color: MUTED }}>
          {t('suggestPrompt')}{' '}
          <button
            onClick={() => setSuggestOpen(true)}
            style={{ background: 'none', border: 'none', padding: 0, color: ORANGE, font: 'inherit', cursor: 'pointer' }}
          >
            {t('suggestCta')}
          </button>
        </div>
      </div>

      {data.season.notes && (
        <div style={{ gridColumn: '1 / -1', background: '#141414', padding: '9px 10px' }}>
          <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            {t('methodNote')}
          </div>
          <div style={{ fontSize: 9, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
        </div>
      )}

      <SuggestChangesSheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        player={{
          id: player.id,
          name: player.name,
          displayName: player.display_name?.trim() || player.name,
          country: player.country,
          birthplace: player.birthplace,
          birthdate: player.birthdate,
          height: player.height,
          hand: player.hand,
          side: player.side,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Confirmar a prop `wide` do `Widget`**

Run: `grep -n "wide" "src/app/[locale]/player/[id]/Widget.tsx"`
Expected: a prop existe e aplica `gridColumn: '1 / -1'`. Se o nome for outro, ajuste as chamadas acima.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"
git commit -m "feat(amateur): summary tab widget grid"
```

---

## Task 11: Abas Temporada e Equipe

**Files:**
- Create: `src/app/[locale]/player/[id]/amateur/SeasonTab.tsx`
- Create: `src/app/[locale]/player/[id]/amateur/TeamTab.tsx`

- [ ] **Step 1: Criar a aba Temporada**

```tsx
'use client'
// src/app/[locale]/player/[id]/amateur/SeasonTab.tsx
// One row per game the player was fielded in. No opponent and no set score —
// the SNP source doesn't carry either.

import { useTranslations } from 'next-intl'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function AmateurSeasonTab({ data }: { data: AmateurProfileData }) {
  const t = useTranslations('amateur')

  return (
    <div style={{ padding: '10px 14px 20px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 8, color: MUTED,
        textTransform: 'uppercase', letterSpacing: 0.8, padding: '8px 0 6px',
        borderBottom: '1px solid #1C1C1C',
      }}>
        <span style={{ flex: 1 }}>{t('roundColumn')}</span>
        <span style={{ width: 74 }}>{t('courtColumn')}</span>
        <span style={{ width: 66 }}>{t('resultColumn')}</span>
        <span style={{ width: 42, textAlign: 'right' }}>{t('setsColumn')}</span>
      </div>

      {data.games.map((g, i) => (
        <div
          key={`${g.fixtureCode}-${i}`}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, padding: '8px 0 8px 7px', borderBottom: '1px solid #171717',
            borderLeft: `2px solid ${g.result === 'W' ? GREEN : RED}`,
            opacity: g.complete ? 1 : 0.65,
          }}
        >
          <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{g.fixtureCode}</span>
          <span style={{ width: 74, fontSize: 9, color: g.worth === 3 ? ORANGE : MUTED }}>
            {t('usualCourtValue', { block: g.worth === 3 ? '1–2' : '3–5' })}
          </span>
          <span style={{ width: 66, fontSize: 10, color: g.result === 'W' ? GREEN : RED }}>
            {g.result === 'W' ? t('won') : t('lost')}
          </span>
          <span style={{ width: 42, textAlign: 'right', fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
            {g.sets != null ? t('setsValue', { count: g.sets }) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Criar a aba Equipe**

```tsx
'use client'
// src/app/[locale]/player/[id]/amateur/TeamTab.tsx
// The squad plus every round of the season, court by court. This is the page
// the operator's source document is really about; the individual profile is a
// slice of it.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function TeamTab({ data, currentPlayerId }: { data: AmateurProfileData; currentPlayerId: string }) {
  const t = useTranslations('amateur')
  const router = useRouter()
  const nameById = new Map(data.roster.map(r => [r.playerId, r.name]))

  return (
    <div style={{ padding: '10px 14px 20px' }}>

      <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {t('squad')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1, background: '#1C1C1C', marginBottom: 20 }}>
        {data.roster.map(r => (
          <button
            key={r.playerId}
            onClick={() => router.push(`/player/${r.playerId}` as Parameters<typeof router.push>[0])}
            style={{
              background: r.playerId === currentPlayerId ? '#1A1A1A' : '#141414',
              padding: '10px 11px', border: 'none', textAlign: 'left', cursor: 'pointer',
              display: 'grid', gap: 3, font: 'inherit', color: 'inherit',
            }}
          >
            <span style={{
              fontSize: 12, fontWeight: 600, color: r.gamesPlayed > 0 ? '#fff' : MUTED,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.name}
            </span>
            <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
              {r.gamesPlayed > 0
                ? t('squadLine', { games: r.gamesPlayed, wins: r.wins, losses: r.losses })
                : t('squadNoGames')}
            </span>
          </button>
        ))}
      </div>

      {data.fixtures.map(f => (
        <div key={f.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #1C1C1C' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>{f.label}</span>
            {f.complete && f.pointsFor != null ? (
              <span style={{ fontSize: 13, fontWeight: 800, color: f.result === 'W' ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
                {f.pointsFor}–{f.pointsAgainst}
              </span>
            ) : (
              <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('partialRound')}</span>
            )}
          </div>

          {!f.complete && (
            <div style={{ fontSize: 9, color: MUTED, padding: '6px 0', lineHeight: 1.5 }}>{t('partialRoundHint')}</div>
          )}

          {f.slots.map(s => (
            <div
              key={s.id}
              style={{
                display: 'grid', gridTemplateColumns: '92px 70px minmax(0, 1fr)', gap: 10,
                padding: '9px 0 9px 7px', borderBottom: '1px solid #171717',
                borderLeft: `2px solid ${s.result === 'W' ? GREEN : RED}`,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                {s.label}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: MUTED }}>{s.worth} pts</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.result === 'W' ? GREEN : RED, textTransform: 'uppercase' }}>
                {s.result === 'W' ? t('won') : t('lost')}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: MUTED, textTransform: 'none' }}>
                  {s.sets != null ? t('setsValue', { count: s.sets }) : '—'}
                </span>
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
                {s.playerIds.map(id => (
                  <button
                    key={id}
                    onClick={() => router.push(`/player/${id}` as Parameters<typeof router.push>[0])}
                    style={{
                      border: '1px solid #2A2A2A', padding: '2px 8px', fontSize: 11, fontWeight: 600,
                      background: 'none', color: id === currentPlayerId ? ORANGE : '#fff',
                      cursor: 'pointer', font: 'inherit',
                    }}
                  >
                    {nameById.get(id) ?? id}
                  </button>
                ))}
                {!s.exact && (
                  <span style={{ width: '100%', fontSize: 9, color: MUTED, marginTop: 3 }}>
                    {t('ambiguousPairing', { count: s.courtCount })}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. Se `router.push` reclamar do tipo do path, siga o padrão já usado em `page.tsx` — o cast `as Parameters<typeof router.push>[0]` é o idioma do repo.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/amateur/"
git commit -m "feat(amateur): season and team tabs"
```

---

## Task 12: Ramificar `page.tsx` por tier

Duas mudanças cirúrgicas no arquivo de 2.220 linhas: sair cedo do `load()` quando o jogador é amador (evita as buscas pesadas de partidas, equipamento e ganhos, que não existem para ele) e renderizar o componente certo.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Importar o componente e o helper**

```tsx
import AmateurProfile, { type AmateurPlayer } from './AmateurProfile'
import { isAmateurTier } from '@/lib/player-tier'
```

- [ ] **Step 2: Cortar o fetch pesado logo depois de `setPlayer(p)`**

No `load()`, imediatamente após `setPlayer(p)` (perto da linha 385):

```tsx
        setPlayer(p)

        // Amateur profiles have no career matches, equipment or earnings —
        // everything below this point would be five wasted round-trips.
        // AmateurProfile loads its own data from the team model.
        if (isAmateurTier((p as { tier?: string }).tier)) {
          if (!cancelled) setLoading(false)
          return
        }
```

- [ ] **Step 3: Ramificar a renderização**

Encontre onde o componente decide o que renderizar depois de `if (loading) ...` / `if (!player) ...` (perto da linha 640, antes do `return (<> <div style={{ background: BG_BASE ...`) e insira:

```tsx
  // Amateur profiles render a different page entirely — different tabs,
  // different data source. `hidden` is the takedown switch from the spec.
  if (player && (player as { hidden?: boolean }).hidden) {
    return (
      <div style={{ background: BG_BASE, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 14 }}>
        {tCommon('notFound')}
      </div>
    )
  }
  if (player && isAmateurTier((player as { tier?: string }).tier)) {
    return <AmateurProfile player={player as unknown as AmateurPlayer} />
  }
```

Se `tCommon('notFound')` não existir no namespace `common`, use a chave equivalente já presente — confirme com `grep -n "notFound" src/messages/en.json`; havendo nenhuma, adicione `"notFound": "Player not found"` em `common` nos cinco locales.

- [ ] **Step 4: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: os três passam.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat(amateur): branch the player page by tier"
```

---

## Task 13: Parsing do CSV

Lógica pura, testável sem banco. O script de I/O vem na Task 14.

**Files:**
- Create: `scripts/lib/amateur-csv.ts`
- Test: `scripts/__tests__/amateur-csv.test.ts`

Formato dos três arquivos, um por conceito:

`players.csv` — `name,side,home_club,competition_points,competition_rank,roster_rank,games_played,wins,losses`
`fixtures.csv` — `code,label,sort_order,complete,result,points_for,points_against,courts_won,courts_lost,opponent_name`
`slots.csv` — `fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players`

Em `slots.csv`, a coluna `players` traz os nomes separados por `|` — é a única coluna multivalorada, e o pipe evita conflito com a vírgula do CSV e com os nomes compostos espanhóis.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// scripts/__tests__/amateur-csv.test.ts
import { describe, it, expect } from 'vitest'
import { parseCsv, parseSlotsCsv, parsePlayersCsv } from '../lib/amateur-csv'

describe('parseCsv', () => {
  it('reads a header row and maps each line onto it', () => {
    const rows = parseCsv('a,b\n1,2\n3,4\n')
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
  })

  it('ignores blank trailing lines', () => {
    expect(parseCsv('a\n1\n\n')).toEqual([{ a: '1' }])
  })

  it('keeps accented names intact', () => {
    expect(parseCsv('name\nAdrián Rivas Fernández')).toEqual([{ name: 'Adrián Rivas Fernández' }])
  })
})

describe('parsePlayersCsv', () => {
  it('coerces numeric columns and leaves blanks as null', () => {
    const rows = parsePlayersCsv(
      'name,side,home_club,competition_points,competition_rank,roster_rank,games_played,wins,losses\n' +
      'Gustavo Denes,drive,Blue Padel,41250.00,412,9,7,2,5\n' +
      'Wenjie Zhou,,,,,,0,0,0\n',
    )
    expect(rows[0]).toEqual({
      name: 'Gustavo Denes', side: 'drive', homeClub: 'Blue Padel',
      competitionPoints: 41250, competitionRank: 412, rosterRank: 9,
      gamesPlayed: 7, wins: 2, losses: 5,
    })
    expect(rows[1].competitionPoints).toBeNull()
    expect(rows[1].side).toBeNull()
    expect(rows[1].gamesPlayed).toBe(0)
  })
})

describe('parseSlotsCsv', () => {
  it('splits the pipe-separated player list', () => {
    const rows = parseSlotsCsv(
      'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
      'J1,1,Pista 1,3,3,W,3,1,true,false,Albert Urbano Torrent|William Yang\n',
    )
    expect(rows[0].playerNames).toEqual(['Albert Urbano Torrent', 'William Yang'])
    expect(rows[0].exact).toBe(true)
    expect(rows[0].partial).toBe(false)
    expect(rows[0].worth).toBe(3)
  })

  it('forces exact to false when the slot covers more than one court', () => {
    const rows = parseSlotsCsv(
      'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
      'J1,3,Pistas 3 y 4,2,2,W,2,2,true,false,A B|C D|E F|G H\n',
    )
    expect(rows[0].exact).toBe(false)
  })

  it('rejects a slot with no players', () => {
    expect(() =>
      parseSlotsCsv(
        'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
        'J1,1,Pista 1,3,3,W,3,1,true,false,\n',
      ),
    ).toThrow(/J1.*sort_order 1.*no players/)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run scripts/__tests__/amateur-csv.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/amateur-csv"`

- [ ] **Step 3: Implementar**

```ts
// scripts/lib/amateur-csv.ts
// Parsing for the amateur season import. Pure — no filesystem, no database.
//
// The operator hands over an Excel workbook; it's converted to three CSVs by
// hand before running the import. Deliberately a plain split parser: the
// source has no quoted fields or embedded commas, and adding a CSV dependency
// for a hand-run import isn't worth it.

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

function num(value: string): number | null {
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function bool(value: string): boolean {
  return value.toLowerCase() === 'true'
}

export interface AmateurPlayerRow {
  name: string
  side: string | null
  homeClub: string | null
  competitionPoints: number | null
  competitionRank: number | null
  rosterRank: number | null
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
}

export function parsePlayersCsv(text: string): AmateurPlayerRow[] {
  return parseCsv(text).map(r => ({
    name: r.name,
    side: r.side || null,
    homeClub: r.home_club || null,
    competitionPoints: num(r.competition_points),
    competitionRank: num(r.competition_rank),
    rosterRank: num(r.roster_rank),
    gamesPlayed: num(r.games_played),
    wins: num(r.wins),
    losses: num(r.losses),
  }))
}

export interface AmateurFixtureRow {
  code: string
  label: string
  sortOrder: number
  complete: boolean
  result: string | null
  pointsFor: number | null
  pointsAgainst: number | null
  courtsWon: number | null
  courtsLost: number | null
  opponentName: string | null
}

export function parseFixturesCsv(text: string): AmateurFixtureRow[] {
  return parseCsv(text).map(r => ({
    code: r.code,
    label: r.label,
    sortOrder: num(r.sort_order) ?? 0,
    complete: bool(r.complete),
    result: r.result || null,
    pointsFor: num(r.points_for),
    pointsAgainst: num(r.points_against),
    courtsWon: num(r.courts_won),
    courtsLost: num(r.courts_lost),
    opponentName: r.opponent_name || null,
  }))
}

export interface AmateurSlotRow {
  fixtureCode: string
  sortOrder: number
  label: string
  worth: number
  slotGroup: number
  result: string | null
  sets: number | null
  courtCount: number
  exact: boolean
  partial: boolean
  playerNames: string[]
}

export function parseSlotsCsv(text: string): AmateurSlotRow[] {
  return parseCsv(text).map(r => {
    const sortOrder = num(r.sort_order) ?? 0
    const playerNames = r.players.split('|').map(n => n.trim()).filter(Boolean)
    if (playerNames.length === 0) {
      throw new Error(`Slot ${r.fixture_code} sort_order ${sortOrder} has no players`)
    }
    const courtCount = num(r.court_count) ?? 1
    return {
      fixtureCode: r.fixture_code,
      sortOrder,
      label: r.label,
      worth: num(r.worth) ?? 0,
      slotGroup: num(r.slot_group) ?? 0,
      result: r.result || null,
      sets: num(r.sets),
      courtCount,
      // A slot spanning several courts can never pin the pairing down,
      // whatever the spreadsheet says.
      exact: bool(r.exact) && courtCount === 1,
      partial: bool(r.partial),
      playerNames,
    }
  })
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run scripts/__tests__/amateur-csv.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/amateur-csv.ts scripts/__tests__/amateur-csv.test.ts
git commit -m "feat(amateur): CSV parsing for the season import"
```

---

## Task 14: Script de import

**Files:**
- Create: `scripts/import-amateur-season.ts`

- [ ] **Step 1: Conferir como os scripts do repo montam o cliente Supabase**

Run: `grep -n "createClient\|SUPABASE_SERVICE_KEY\|dotenv\|\.env.local" scripts/apply-fip-oop-schedule-now.ts | head`
Expected: o padrão do repo para autenticar com a service key. Use exatamente esse padrão no script novo em vez do esboço abaixo, se divergirem.

- [ ] **Step 2: Escrever o script**

```ts
// scripts/import-amateur-season.ts
//
// Imports one amateur team season from three CSVs into the team model.
//
//   npx tsx scripts/import-amateur-season.ts --dir ./import/blue-padel-25-26 \
//     --team-slug blue-padel-mataro --team-name "Blue Padel Mataró" \
//     --season 25/26 --source snp --external-id blue-padel-mataro-2526
//
// Defaults to a dry run. Pass --apply to write.
// Idempotent: re-running with the same inputs updates in place, never
// duplicates. Conflict keys match the unique constraints in the migration.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parsePlayersCsv, parseFixturesCsv, parseSlotsCsv } from './lib/amateur-csv'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required --${name}`)
}

const APPLY = process.argv.includes('--apply')
const DIR = arg('dir')
const TEAM_SLUG = arg('team-slug')
const TEAM_NAME = arg('team-name')
const SEASON_LABEL = arg('season')
const SOURCE = arg('source', 'manual')
const EXTERNAL_ID = arg('external-id', TEAM_SLUG)
const COMPETITION = arg('competition', '')
const CATEGORY = arg('category', 'men')
const NOTES = arg('notes', '')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/** Same normalisation the players table uses for normalized_name. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function main() {
  const players = parsePlayersCsv(fs.readFileSync(path.join(DIR, 'players.csv'), 'utf8'))
  const fixtures = parseFixturesCsv(fs.readFileSync(path.join(DIR, 'fixtures.csv'), 'utf8'))
  const slots = parseSlotsCsv(fs.readFileSync(path.join(DIR, 'slots.csv'), 'utf8'))

  // Every name referenced anywhere must exist in players.csv, or the roster
  // and the line-ups would disagree.
  const known = new Set(players.map(p => normalize(p.name)))
  const orphans = [...new Set(slots.flatMap(s => s.playerNames))].filter(n => !known.has(normalize(n)))
  if (orphans.length > 0) {
    throw new Error(`Names in slots.csv missing from players.csv: ${orphans.join(', ')}`)
  }
  const fixtureCodes = new Set(fixtures.map(f => f.code))
  const badSlots = slots.filter(s => !fixtureCodes.has(s.fixtureCode))
  if (badSlots.length > 0) {
    throw new Error(`Slots reference unknown fixtures: ${[...new Set(badSlots.map(s => s.fixtureCode))].join(', ')}`)
  }

  // Match existing players by normalized name; the rest get created as amateurs.
  const { data: existing } = await supabase
    .from('players')
    .select('id, name, normalized_name, tier')
    .in('normalized_name', players.map(p => normalize(p.name)))

  const idByNormalized = new Map<string, string>()
  for (const row of existing ?? []) {
    if (row.normalized_name) idByNormalized.set(row.normalized_name, row.id)
  }
  const toCreate = players.filter(p => !idByNormalized.has(normalize(p.name)))

  console.log(`Team:      ${TEAM_NAME} (${TEAM_SLUG})`)
  console.log(`Season:    ${SEASON_LABEL}`)
  console.log(`Players:   ${players.length} — ${players.length - toCreate.length} matched, ${toCreate.length} to create`)
  console.log(`Fixtures:  ${fixtures.length}`)
  console.log(`Slots:     ${slots.length}`)
  if (toCreate.length > 0) console.log(`Creating:  ${toCreate.map(p => p.name).join(', ')}`)

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.')
    return
  }

  for (const p of toCreate) {
    const { data, error } = await supabase
      .from('players')
      .insert({ name: p.name, tier: 'amateur', side: p.side, home_club: p.homeClub, category: CATEGORY })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to create ${p.name}: ${error?.message}`)
    idByNormalized.set(normalize(p.name), data.id)
  }

  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .upsert(
      { slug: TEAM_SLUG, name: TEAM_NAME, competition: COMPETITION || null, category: CATEGORY, source: SOURCE, external_id: EXTERNAL_ID },
      { onConflict: 'source,external_id' },
    )
    .select('id')
    .single()
  if (teamErr || !team) throw new Error(`Failed to upsert team: ${teamErr?.message}`)

  const complete = fixtures.filter(f => f.complete)
  const { data: season, error: seasonErr } = await supabase
    .from('team_seasons')
    .upsert(
      {
        team_id: team.id,
        label: SEASON_LABEL,
        notes: NOTES || null,
        ties_played: complete.length,
        ties_won: complete.filter(f => f.result === 'W').length,
        points_for: complete.reduce((a, f) => a + (f.pointsFor ?? 0), 0),
        points_against: complete.reduce((a, f) => a + (f.pointsAgainst ?? 0), 0),
        courts_won: complete.reduce((a, f) => a + (f.courtsWon ?? 0), 0),
        courts_lost: complete.reduce((a, f) => a + (f.courtsLost ?? 0), 0),
      },
      { onConflict: 'team_id,label' },
    )
    .select('id')
    .single()
  if (seasonErr || !season) throw new Error(`Failed to upsert season: ${seasonErr?.message}`)

  for (const p of players) {
    const playerId = idByNormalized.get(normalize(p.name))!
    const { error } = await supabase.from('team_memberships').upsert(
      {
        team_season_id: season.id, player_id: playerId,
        competition_points: p.competitionPoints, competition_rank: p.competitionRank,
        roster_rank: p.rosterRank, games_played: p.gamesPlayed, wins: p.wins, losses: p.losses,
      },
      { onConflict: 'team_season_id,player_id' },
    )
    if (error) throw new Error(`Failed to upsert membership for ${p.name}: ${error.message}`)
  }

  const fixtureIdByCode = new Map<string, string>()
  for (const f of fixtures) {
    const { data, error } = await supabase.from('team_fixtures').upsert(
      {
        team_season_id: season.id, code: f.code, label: f.label, sort_order: f.sortOrder,
        complete: f.complete, result: f.result, points_for: f.pointsFor,
        points_against: f.pointsAgainst, courts_won: f.courtsWon, courts_lost: f.courtsLost,
        opponent_name: f.opponentName,
      },
      { onConflict: 'team_season_id,code' },
    ).select('id').single()
    if (error || !data) throw new Error(`Failed to upsert fixture ${f.code}: ${error?.message}`)
    fixtureIdByCode.set(f.code, data.id)
  }

  for (const s of slots) {
    const fixtureId = fixtureIdByCode.get(s.fixtureCode)!
    const { data, error } = await supabase.from('team_fixture_slots').upsert(
      {
        fixture_id: fixtureId, label: s.label, worth: s.worth, slot_group: s.slotGroup,
        result: s.result, sets: s.sets, court_count: s.courtCount,
        exact: s.exact, partial: s.partial, sort_order: s.sortOrder,
      },
      { onConflict: 'fixture_id,sort_order' },
    ).select('id').single()
    if (error || !data) throw new Error(`Failed to upsert slot ${s.fixtureCode}/${s.sortOrder}: ${error?.message}`)

    // Replace the line-up wholesale so a corrected re-import drops stale names.
    await supabase.from('team_fixture_slot_players').delete().eq('slot_id', data.id)
    const rows = s.playerNames.map(n => ({ slot_id: data.id, player_id: idByNormalized.get(normalize(n))! }))
    const { error: linkErr } = await supabase.from('team_fixture_slot_players').insert(rows)
    if (linkErr) throw new Error(`Failed to link players on ${s.fixtureCode}/${s.sortOrder}: ${linkErr.message}`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
```

- [ ] **Step 3: Rodar em dry-run com os CSVs reais**

Coloque os três arquivos convertidos do Excel em `import/blue-padel-25-26/` (fora do git — adicione `import/` ao `.gitignore` se ainda não estiver).

Run:
```bash
npx tsx scripts/import-amateur-season.ts --dir ./import/blue-padel-25-26 \
  --team-slug blue-padel-mataro --team-name "Blue Padel Mataró" \
  --season 25/26 --source snp --external-id blue-padel-mataro-2526 \
  --competition "Series Nacionales de Pádel · Barcelona · Masculino 1000"
```

Expected: contagens coerentes com a fonte (24 jogadores, 11 jornadas, ~50 pistas) e a linha `Dry run — nothing written.`

- [ ] **Step 4: Aplicar**

Run: o mesmo comando com `--apply` no fim.
Expected: termina em `Done.` sem erro.

- [ ] **Step 5: Rodar de novo para provar idempotência**

Run: o mesmo comando com `--apply` outra vez.
Expected: `Done.` de novo, e as contagens no banco não mudam:

```bash
node -e "
const {createClient}=require('@supabase/supabase-js');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
(async()=>{
  for(const tb of ['team_memberships','team_fixtures','team_fixture_slots','team_fixture_slot_players']){
    const {count}=await s.from(tb).select('*',{count:'exact',head:true});
    console.log(tb,count);
  }
})();
"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/import-amateur-season.ts .gitignore
git commit -m "feat(amateur): season import script"
```

---

## Task 15: Verificação no app rodando

Mudanças visíveis no browser não estão prontas até serem vistas funcionando.

**Files:** nenhum — verificação.

- [ ] **Step 1: Subir o dev server**

Use a ferramenta de preview do harness (`preview_start`), nunca `npm run dev` via bash. A config fica em `.claude/launch.json`; a porta é 3002.

- [ ] **Step 2: Abrir o perfil amador**

Pegue o id do Gustavo:

```bash
node -e "
const {createClient}=require('@supabase/supabase-js');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
s.from('players').select('id,name').eq('tier','amateur').ilike('name','%Denes%').then(r=>console.log(r.data));
"
```

Navegue para `/player/<id>` e confirme:
- Hero com selo `Amador · Series Nacionales de Pádel`, quatro chips (Jogos 7, Balanço 2–5, Ranking #412, Posição), faixa da equipe.
- Aba Resumo: barras de últimos jogos animando ao entrar na viewport, pista habitual, aproveitamento, pontos, parceiros com o chip de "prováveis", link de sugerir alteração, nota de método.
- Aba Temporada: uma linha por jogo, jornadas parciais com opacidade reduzida.
- Aba Equipe: 24 cards no plantel (incluindo os 3 sem jogos), jornadas com pistas e o aviso de dupla ambígua onde `exact=false`.

- [ ] **Step 3: Conferir o console e a rede**

Use `read_console_messages` e `read_network_requests`.
Expected: sem erros; nenhuma requisição 4xx/5xx do Supabase.

- [ ] **Step 4: Confirmar que o perfil profissional continua igual**

Navegue para o perfil de um jogador pro qualquer (`/player/<id-pro>`) e confirme que as seis abas, o Últimos 10 e o Road to Trophy seguem funcionando — a Task 5 mexeu no arquivo dele.

- [ ] **Step 5: Testar o `hidden`**

```bash
node -e "
const {createClient}=require('@supabase/supabase-js');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
s.from('players').update({hidden:true}).eq('id',process.argv[1]).then(r=>console.log(r.error??'hidden=true'));
" "<id>"
```

Recarregue a página: deve mostrar a mensagem de não encontrado. Rode o mesmo comando com `hidden:false` para reverter.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tudo verde.

- [ ] **Step 7: Screenshot para o operador**

Tire um screenshot do perfil e mande junto com o resumo do que foi verificado.

---

## Notas de encerramento

- **Não mexer** no worker `player-rankings` do padelgod: amadores não têm `fip_id`, e ele resolve por `fip_id`, então já não os alcança. Confirme com `grep -n "fip_id" padelgod/src/workers/player-rankings.ts` antes de dar por encerrado; se houver algum caminho por nome, aí sim adicione o filtro de tier.
- A busca global (`src/lib/player-search.ts`) inclui amadores por decisão do operador. Não filtre por tier lá.
- `teams` nasce agnóstica de amador. Nada neste plano assume que jogadores de uma equipe são amadores — usar a mesma tabela para um evento profissional por equipes não exige mudança de schema.
