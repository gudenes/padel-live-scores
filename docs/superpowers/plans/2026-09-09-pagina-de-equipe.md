# Página de equipe + raquete no perfil amador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à equipe um endereço público próprio em `/snp/[slug]`, mostrar a raquete no perfil amador sem perder o rastreamento de afiliado, e encolher a aba Equipe para um resumo que leva à página.

**Architecture:** O widget de raquete sai de dentro do `page.tsx` e vira componente compartilhado, levando junto a chamada de afiliado. `amateur-profile.ts` passa a receber o cliente Supabase por parâmetro, o que é o que permite a página nova ser server-rendered com o cliente anônimo. A montagem de jornadas vira função pura compartilhada entre o perfil e a página, para a regra de dupla incerta não bifurcar.

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, TypeScript, Supabase, Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-09-pagina-de-equipe-design.md`](../specs/2026-09-09-pagina-de-equipe-design.md)

**Branch:** `feat/amateur-admin-v2` · worktree `.worktrees/amateur-profiles`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/supabase.ts` | **Modificar** — expor `createAnonServerClient()` |
| `src/lib/amateur-profile.ts` | **Modificar** — cliente por parâmetro; `fetchTeamSeason`; builders puros exportados |
| `src/app/[locale]/player/[id]/PlaysWithCard.tsx` | Widget de raquete compartilhado, com o clique de afiliado |
| `src/app/[locale]/player/[id]/page.tsx` | **Modificar** — consumir `PlaysWithCard`; passar o cliente |
| `src/app/[locale]/player/[id]/AmateurProfile.tsx` | **Modificar** — buscar equipamento; passar o cliente |
| `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` | **Modificar** — renderizar `PlaysWithCard` |
| `src/app/[locale]/player/[id]/amateur/TeamTab.tsx` | **Modificar** — vira card resumo recolhível |
| `src/app/[locale]/snp/[slug]/page.tsx` | Página de equipe (Server Component) + metadata + JSON-LD |
| `src/app/[locale]/snp/[slug]/TeamRoster.tsx` | Grade do elenco (client, navegação) |
| `src/app/[locale]/snp/[slug]/TeamFixtures.tsx` | Jornadas pista a pista (client, navegação) |
| `src/app/sitemap-teams.xml/route.ts` | Sitemap das equipes |
| `src/app/sitemap.xml/route.ts` | **Modificar** — registrar o filho novo |
| `src/messages/{en,es,pt,it,fr}.json` | **Modificar** — namespace `team.*` |

`TeamRoster` e `TeamFixtures` são client components porque navegam ao clicar num jogador; o resto da página é servidor. Eles são extraídos do `TeamTab.tsx` atual, não escritos do zero — o markup já existe e foi verificado no browser.

---

## Task 1: Cliente anônimo de servidor

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Acrescentar a factory**

Depois de `createServiceClient`, antes do alias `createServerClient`:

```ts
/**
 * Server-side client with the ANON key — RLS applies exactly as it does for a
 * visitor's browser. Use this for server-rendered public pages.
 *
 * Deliberately not the service client: that one bypasses RLS, so the day a
 * policy is tightened (say, to respect players.hidden) a page built on it
 * would keep serving what the policy started protecting, with no signal.
 */
export function createAnonServerClient() {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anon) {
    throw new Error(
      'createAnonServerClient requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
    )
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3`
Expected: nenhuma saída.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(supabase): anon server client for public server-rendered pages"
```

---

## Task 2: Cliente por parâmetro em `amateur-profile.ts`

O módulo importa hoje o cliente do browser. Um Server Component não pode usá-lo, então a dependência é invertida.

**Files:**
- Modify: `src/lib/amateur-profile.ts`
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`
- Modify: `src/app/[locale]/player/[id]/amateur/SeasonTab.tsx`

- [ ] **Step 1: Trocar o import pelo parâmetro**

Em `src/lib/amateur-profile.ts`, remova `import { supabase } from '@/lib/supabase'` e acrescente:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
```

Mude as duas assinaturas de I/O para receber o cliente como primeiro argumento:

```ts
export async function fetchAmateurSeasons(
  client: SupabaseClient,
  playerId: string,
): Promise<AmateurSeasonRef[]> {
```

```ts
export async function fetchAmateurProfile(
  client: SupabaseClient,
  playerId: string,
  seasonId?: string,
): Promise<AmateurProfileData | null> {
```

Dentro dos corpos, troque cada `supabase.` por `client.`.

- [ ] **Step 2: Atualizar os dois chamadores**

Em `AmateurProfile.tsx` e `amateur/SeasonTab.tsx` acrescente o import do cliente do browser e passe-o:

```tsx
import { supabase } from '@/lib/supabase'
```

`fetchAmateurSeasons(supabase, player.id)` e `fetchAmateurProfile(supabase, player.id, seasonId)`.

Localize todas as chamadas com:

Run: `grep -rn "fetchAmateurSeasons(\|fetchAmateurProfile(" src/ --include=*.tsx --include=*.ts | grep -v "amateur-profile.ts"`

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5 && npx vitest run src/lib/__tests__/amateur-profile.test.ts src/lib/__tests__/amateur-seasons.test.ts 2>&1 | grep -E "Tests|Test Files"`
Expected: sem erros de tipo; 12 testes passando. `buildAmateurProfile` é pura e não é afetada.

- [ ] **Step 4: Commit**

```bash
git add src/lib/amateur-profile.ts "src/app/[locale]/player/[id]/AmateurProfile.tsx" "src/app/[locale]/player/[id]/amateur/SeasonTab.tsx"
git commit -m "refactor(amateur): take the Supabase client as a parameter"
```

---

## Task 3: Extrair o widget de raquete

**Files:**
- Create: `src/app/[locale]/player/[id]/PlaysWithCard.tsx`
- Modify: `src/app/[locale]/player/[id]/page.tsx:1210-1340`

- [ ] **Step 1: Criar o componente**

Crie `PlaysWithCard.tsx` com `'use client'` no topo e mova para dentro dele **o bloco inteiro** que hoje começa no comentário `{/* Equipment — "Plays with" ... */}` em `page.tsx` (~linha 1210) e termina no fecho do IIFE.

A interface:

```tsx
export interface PlaysWithRacket {
  id: string | null
  model: string | null
  year: number | null
  shape: string | null
  weight_grams: number | null
  balance: string | null
  image_url: string | null
  product_url: string | null
  brand: { name: string; logo_url: string | null } | null
}

export interface PlaysWithLegacy {
  racket_brand?: string
  racket_model?: string
  racket_url?: string
  racket_image?: string
  brand_logo?: string
}

export function PlaysWithCard({
  racket,
  legacy,
  playerId,
}: {
  racket: PlaysWithRacket | null
  legacy?: PlaysWithLegacy | null
  playerId: string
}) {
```

O estado `brandLogoFailed` hoje vive no componente pai; ele **move para dentro** do card, com `useState(false)`. O `t` vem de `useTranslations('player')` dentro do componente, não por prop.

Preserve sem alteração: o `handleRacketClick` com o `POST /api/racket-click` e o fallback silencioso para `product_url`, o `if (!brandName) return null`, os `specPillStyle`/`specRowStyle`/`specValueStyle`, e o `<Widget wide label={t('playsWith')}>`.

- [ ] **Step 2: Consumir no perfil profissional**

Em `page.tsx`, no lugar do bloco removido:

```tsx
      <PlaysWithCard
        racket={currentEquipment?.racket ?? null}
        legacy={player.equipment}
        playerId={player.id}
      />
```

E o import:

```tsx
import { PlaysWithCard } from './PlaysWithCard'
```

- [ ] **Step 3: Provar que o perfil profissional não mudou**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npm run lint 2>&1 | grep -c "PlaysWithCard" ; npm run build 2>&1 | tail -2`
Expected: sem erros de tipo, sem lint novo no arquivo, build conclui.

Depois, no browser (o servidor de produção roda na 3007): abra `/es/player/c95d2602-fb24-4b4b-9c60-40a0950a4eae` (Tapia) e confirme que o card "Plays with" aparece igual — logo da marca, modelo, specs e o botão. **Clique no botão** e confirme no painel de rede que o `POST /api/racket-click` sai. Esse é o ponto inteiro da extração: se o POST sumir, a receita de afiliado some com ele.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/PlaysWithCard.tsx" "src/app/[locale]/player/[id]/page.tsx"
git commit -m "refactor(player): extract the Plays with card, affiliate tracking included"
```

---

## Task 4: Raquete no perfil amador

**Files:**
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`
- Modify: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`

- [ ] **Step 1: Buscar o equipamento**

Em `AmateurProfile.tsx`, acrescente o estado e o fetch — mesmo shape que `page.tsx` usa:

```tsx
  const [racket, setRacket] = useState<PlaysWithRacket | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('player_equipment')
      .select('racket:padel_rackets(id, model, year, shape, weight_grams, balance, image_url, product_url, brand:padel_brands(name, logo_url))')
      .eq('player_id', player.id)
      .is('ended_at', null)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const row = data as unknown as { racket: PlaysWithRacket | null } | null
        setRacket(row?.racket ?? null)
      })
    return () => { cancelled = true }
  }, [player.id])
```

Import: `import { type PlaysWithRacket } from './PlaysWithCard'`.

Passe `racket={racket}` para `<SummaryTab … />`.

- [ ] **Step 2: Renderizar no Resumo**

Em `SummaryTab.tsx`, acrescente `racket` às props e, logo abaixo do widget de parceiros:

```tsx
      {racket && <PlaysWithCard racket={racket} playerId={player.id} />}
```

Import: `import { PlaysWithCard, type PlaysWithRacket } from '../PlaysWithCard'`.

Sem raquete nada é renderizado — 23 dos 24 jogadores estão nessa situação e um card vazio repetido seria ruído.

- [ ] **Step 3: Verificar no browser**

Rebuild (`npm run build`) e reinicie a 3007. Abra `/es/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0` — o operador cadastrou uma Babolat Air Viper 2025 nesse jogador, então o card deve aparecer. Abra outro amador qualquer e confirme que **não** há card nem espaço vazio.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/AmateurProfile.tsx" "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"
git commit -m "feat(amateur): show the racket on the profile when there is one"
```

---

## Task 5: `fetchTeamSeason` e os builders puros

**Files:**
- Modify: `src/lib/amateur-profile.ts`
- Test: `src/lib/__tests__/team-season.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/team-season.test.ts
// The team-season view feeds /snp/[slug]. Its fixture/roster shaping must be
// the same code the player profile uses — if the two diverge, the uncertain-
// pairing rule diverges with them, and that rule is a claim about real people.
import { describe, it, expect } from 'vitest'
import { buildTeamSeason, buildAmateurProfile, fetchTeamSeason, type AmateurRawRows } from '../amateur-profile'

const RAW: AmateurRawRows = {
  membership: {
    team_season_id: 'ts-1', player_id: 'p-1',
    competition_points: 41250, competition_rank: 412, roster_rank: 5,
    games_played: 2, wins: 1, losses: 1,
  },
  season: {
    id: 'ts-1', team_id: 't-1', label: '25/26', ranking: 7,
    ties_played: 9, ties_won: 3, courts_won: 20, courts_lost: 25,
    points_for: 46, points_against: 62, notes: 'Reconstruído da SNP.',
  },
  team: {
    id: 't-1', slug: 'blue-padel-mataro', name: 'Blue Padel Mataró',
    club: 'Blue Padel', city: 'Mataró', country: 'ES', crest_url: null,
    competition: 'Series Nacionales de Pádel', category: 'men',
    badge_label: 'Amador · SNP', short_name: 'SNP',
  },
  roster: [
    { player_id: 'p-1', roster_rank: 5, games_played: 2, wins: 1, losses: 1, player: { id: 'p-1', name: 'Gustavo Denes', avatar_url: null } },
    { player_id: 'p-2', roster_rank: 22, games_played: 0, wins: 0, losses: 0, player: { id: 'p-2', name: 'Wenjie Zhou', avatar_url: null } },
  ],
  fixtures: [
    { id: 'f-1', code: 'J1', label: 'Jornada 1', sort_order: 1, complete: true, result: 'W', points_for: 9, points_against: 3, courts_won: 4, courts_lost: 1, opponent_name: null, played_on: null },
  ],
  slots: [
    { id: 's-1', fixture_id: 'f-1', label: 'Pista 1', worth: 3, slot_group: 3, result: 'W', sets: 3, court_count: 1, exact: true, partial: false, sort_order: 1, player_ids: ['p-1', 'p-9'] },
    { id: 's-2', fixture_id: 'f-1', label: 'Pistas 3 y 4', worth: 2, slot_group: 2, result: 'W', sets: 2, court_count: 2, exact: true, partial: false, sort_order: 3, player_ids: ['p-2', 'p-3', 'p-4', 'p-5'] },
  ],
}

describe('buildTeamSeason', () => {
  const team = buildTeamSeason(RAW)

  it('carries team and season identity', () => {
    expect(team.team.name).toBe('Blue Padel Mataró')
    expect(team.season.ties_won).toBe(3)
  })

  it('keeps roster members who never played, ordered by roster rank', () => {
    expect(team.roster.map(r => r.playerId)).toEqual(['p-1', 'p-2'])
    expect(team.roster[1].gamesPlayed).toBe(0)
  })

  it('forces exact to false on a multi-court slot', () => {
    const multi = team.fixtures[0].slots.find(s => s.label === 'Pistas 3 y 4')!
    expect(multi.exact).toBe(false)
    expect(multi.courtCount).toBe(2)
  })

  it('produces the same fixtures the player profile does', () => {
    // Same input, same shaping — this is what proves the extraction did not
    // fork the uncertain-pairing rule into two copies that can drift.
    const profile = buildAmateurProfile('p-1', RAW)
    expect(team.fixtures).toEqual(profile.fixtures)
    expect(team.roster).toEqual(profile.roster)
  })
})

describe('fetchTeamSeason league scoping', () => {
  it('filters by both slug and source', async () => {
    // /snp/<x> must never serve a team from another league. The URL promises
    // the league, so the query has to honour it — asserting on the filters is
    // how we keep that promise under refactoring.
    const applied: Array<{ method: string; args: unknown[] }> = []
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => (...args: unknown[]) => { applied.push({ method: m, args }); return builder }
    builder.select = chain('select')
    builder.eq = chain('eq')
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
    const client = { from: () => builder }

    const result = await fetchTeamSeason(client as never, 'blue-padel-mataro', 'snp')

    expect(result).toBeNull()
    const eqs = applied.filter(a => a.method === 'eq').map(a => a.args)
    expect(eqs).toContainEqual(['slug', 'blue-padel-mataro'])
    expect(eqs).toContainEqual(['source', 'snp'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/team-season.test.ts`
Expected: FAIL — `buildTeamSeason` e `fetchTeamSeason` não são exportados.

- [ ] **Step 3: Extrair os builders e implementar**

Em `src/lib/amateur-profile.ts`, extraia de dentro de `buildAmateurProfile` as duas montagens para funções no escopo do módulo:

```ts
/** Fixtures with their slots, ordered. Shared by the profile and the team page. */
export function buildFixtures(raw: AmateurRawRows): AmateurFixture[] {
  const ordered = [...raw.fixtures].sort((a, b) => a.sort_order - b.sort_order)
  return ordered.map(f => ({
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
}

/** Squad, ordered by roster rank, players who never played included. */
export function buildRoster(raw: AmateurRawRows): AmateurRosterEntry[] {
  return raw.roster
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
}
```

Dentro de `buildAmateurProfile`, substitua os dois blocos inline por `buildFixtures(raw)` e `buildRoster(raw)`. **Não mude mais nada nela** — seus 8 testes provam que o comportamento é o mesmo.

Acrescente o tipo e o builder da página:

```ts
export interface TeamSeasonPageData {
  team: AmateurRawRows['team']
  season: AmateurRawRows['season']
  roster: AmateurRosterEntry[]
  fixtures: AmateurFixture[]
}

/** Team-season view: everything about the squad, nothing about one player. */
export function buildTeamSeason(raw: AmateurRawRows): TeamSeasonPageData {
  return {
    team: raw.team,
    season: raw.season,
    roster: buildRoster(raw),
    fixtures: buildFixtures(raw),
  }
}
```

E o fetch:

```ts
/**
 * Loads a team season by slug WITHIN a league. Resolving by slug alone would
 * let /snp/<x> serve a team from another league — the URL promises the league,
 * so the query has to honour it.
 */
export async function fetchTeamSeason(
  client: SupabaseClient,
  slug: string,
  source: string,
  seasonLabel?: string,
): Promise<TeamSeasonPageData | null> {
  const { data: team } = await client
    .from('teams')
    .select('id, slug, name, club, city, country, crest_url, competition, category, badge_label, short_name')
    .eq('slug', slug)
    .eq('source', source)
    .maybeSingle()
  if (!team) return null

  let seasonQuery = client
    .from('team_seasons')
    .select('id, team_id, label, starts_on, ranking, ties_played, ties_won, courts_won, courts_lost, points_for, points_against, notes')
    .eq('team_id', team.id)
  if (seasonLabel) seasonQuery = seasonQuery.eq('label', seasonLabel)

  const { data: seasons } = await seasonQuery
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('label', { ascending: false })
    .limit(1)
  const season = seasons?.[0]
  if (!season) return null

  const { data: roster } = await client
    .from('team_memberships')
    .select('player_id, roster_rank, games_played, wins, losses, player:players(id, name, avatar_url)')
    .eq('team_season_id', season.id)

  const { data: fixtures } = await client
    .from('team_fixtures')
    .select('id, code, label, sort_order, complete, result, points_for, points_against, courts_won, courts_lost, opponent_name, played_on')
    .eq('team_season_id', season.id)
    .order('sort_order')

  const fixtureIds = (fixtures ?? []).map(f => f.id)
  const { data: slots } = fixtureIds.length
    ? await client
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

  return buildTeamSeason({
    // membership is player-scoped and unused by the team view; a zeroed stub
    // keeps the shared AmateurRawRows shape without pretending a player exists.
    membership: {
      team_season_id: season.id, player_id: '',
      competition_points: null, competition_rank: null, roster_rank: null,
      games_played: null, wins: null, losses: null,
    },
    season,
    team,
    roster: (roster ?? []) as unknown as AmateurRawRows['roster'],
    fixtures: (fixtures ?? []) as AmateurRawRows['fixtures'],
    slots: normalizedSlots as AmateurRawRows['slots'],
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/team-season.test.ts src/lib/__tests__/amateur-profile.test.ts`
Expected: PASS — 5 + 8 = 13 tests. Os 8 antigos passarem é o que prova que a extração não mudou comportamento.

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-profile.ts src/lib/__tests__/team-season.test.ts
git commit -m "feat(team): team-season view sharing the profile's fixture shaping"
```

---

## Task 6: i18n do namespace `team`

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Acrescentar o bloco em `en.json`**

```json
  "team": {
    "squad": "Squad",
    "rounds": "Rounds",
    "tiesWon": "Ties won",
    "courtRecord": "Court record",
    "pointsFor": "Points for / against",
    "seasonLabel": "Season",
    "noGames": "no games",
    "playerLine": "{games} games · {wins}–{losses}",
    "won": "Won",
    "lost": "Lost",
    "setsValue": "{count} sets",
    "partialRound": "Partial record",
    "partialRoundHint": "Only part of the line-up could be confirmed, so no score is shown.",
    "ambiguousPairing": "Same result on {count} courts — the exact pairing isn't recorded.",
    "methodNote": "Method and limitations",
    "viewTeam": "View the full team",
    "metaTitle": "{team} — {competition} {season}",
    "metaDescription": "{team} in {competition}, season {season}: {tiesWon} of {tiesPlayed} ties won, {courtsWon}–{courtsLost} on court."
  },
```

- [ ] **Step 2: Traduzir nos outros quatro**

Mesmas chaves em `es`, `pt`, `it`, `fr`, no mesmo registro dos namespaces vizinhos. Nome da equipe, competição e a nota de método vêm do banco e não são traduzidos.

Referência para `pt.json`: `"squad": "Plantel"`, `"rounds": "Jornadas"`, `"tiesWon": "Eliminatórias ganhas"`, `"courtRecord": "Balanço em pista"`, `"pointsFor": "Pontos a favor / contra"`, `"seasonLabel": "Temporada"`, `"noGames": "sem jogos"`, `"playerLine": "{games} jogos · {wins}–{losses}"`, `"won": "Ganha"`, `"lost": "Perdida"`, `"setsValue": "{count} sets"`, `"partialRound": "Registro parcial"`, `"partialRoundHint": "Só parte da escalação pôde ser confirmada, então o placar não é mostrado."`, `"ambiguousPairing": "Mesmo resultado em {count} pistas — a dupla exata não consta."`, `"methodNote": "Método e limitações"`, `"viewTeam": "Ver a equipe completa"`, `"metaTitle": "{team} — {competition} {season}"`, `"metaDescription": "{team} no {competition}, temporada {season}: {tiesWon} de {tiesPlayed} eliminatórias ganhas, {courtsWon}–{courtsLost} em pista."`

- [ ] **Step 3: Verificar paridade**

```bash
node -e "
const l=['en','es','pt','it','fr'].map(x=>[x,require('./src/messages/'+x+'.json').team]);
const base=Object.keys(l[0][1]).sort();
for(const [n,o] of l){if(!o){console.error(n,'missing');process.exit(1)}
 const k=Object.keys(o).sort();
 if(JSON.stringify(k)!==JSON.stringify(base)){console.error(n,'mismatch',{missing:base.filter(x=>!k.includes(x)),extra:k.filter(x=>!base.includes(x))});process.exit(1)}}
console.log('all five carry the same', base.length, 'team keys');
"
```

Expected: `all five carry the same 18 team keys`

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "feat(team): i18n strings for the team page"
```

---

## Task 7: Componentes de elenco e jornadas

Extraídos do `TeamTab.tsx` atual, cujo markup já foi verificado no browser.

**Files:**
- Create: `src/app/[locale]/snp/[slug]/TeamRoster.tsx`
- Create: `src/app/[locale]/snp/[slug]/TeamFixtures.tsx`

- [ ] **Step 1: Criar `TeamRoster.tsx`**

```tsx
'use client'
// Squad grid for the team page. Client-side because each card navigates.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurRosterEntry } from '@/lib/amateur-profile'

const MUTED = '#8A8A8A'

export function TeamRoster({ roster }: { roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const router = useRouter()

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 1, background: '#1C1C1C',
    }}>
      {roster.map(r => (
        <button
          key={r.playerId}
          onClick={() => router.push(`/player/${r.playerId}` as Parameters<typeof router.push>[0])}
          style={{
            background: '#141414', padding: '10px 11px', border: 'none', textAlign: 'left',
            cursor: 'pointer', display: 'grid', gap: 3, font: 'inherit', color: 'inherit',
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
              ? t('playerLine', { games: r.gamesPlayed, wins: r.wins, losses: r.losses })
              : t('noGames')}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Criar `TeamFixtures.tsx`**

```tsx
'use client'
// Round-by-round, court by court. Client-side because player chips navigate.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurFixture, AmateurRosterEntry } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const MUTED = '#8A8A8A'

export function TeamFixtures({
  fixtures, roster,
}: { fixtures: AmateurFixture[]; roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const router = useRouter()
  const nameById = new Map(roster.map(r => [r.playerId, r.name]))

  return (
    <>
      {fixtures.map(f => (
        <div key={f.id} style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            paddingBottom: 6, borderBottom: '1px solid #1C1C1C',
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>
              {f.label}
            </span>
            {f.complete && f.pointsFor != null ? (
              <span style={{
                fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: f.result === 'W' ? GREEN : RED,
              }}>
                {f.pointsFor}–{f.pointsAgainst}
              </span>
            ) : (
              <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {t('partialRound')}
              </span>
            )}
          </div>

          {!f.complete && (
            <div style={{ fontSize: 9, color: MUTED, padding: '6px 0', lineHeight: 1.5 }}>
              {t('partialRoundHint')}
            </div>
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
                <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: MUTED }}>
                  {s.worth} pts
                </span>
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                color: s.result === 'W' ? GREEN : RED,
              }}>
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
                      background: 'none', color: '#fff', cursor: 'pointer', font: 'inherit',
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
    </>
  )
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3`
Expected: nenhuma saída.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/snp/[slug]/TeamRoster.tsx" "src/app/[locale]/snp/[slug]/TeamFixtures.tsx"
git commit -m "feat(team): roster and fixtures components for the team page"
```

---

## Task 8: A página `/snp/[slug]`

**Files:**
- Create: `src/app/[locale]/snp/[slug]/page.tsx`

- [ ] **Step 1: Criar a página**

```tsx
// src/app/[locale]/snp/[slug]/page.tsx
// Public team page for a Series Nacionales de Pádel club.
//
// Server-rendered on purpose: this is a shareable destination, so a crawler
// has to see content, not a client-side shell. It reads with the ANON server
// client so what it renders is exactly what an anonymous visitor may read —
// the service client would bypass RLS.
//
// `snp` is a literal folder rather than a dynamic [league] segment: a dynamic
// one would sit at the locale root and could shadow, or be shadowed by, any
// top-level route. A second league becomes a second folder.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createAnonServerClient } from '@/lib/supabase'
import { fetchTeamSeason } from '@/lib/amateur-profile'
import { FlagImage } from '@/components/FlagImage'
import BottomNav from '@/components/nav/BottomNavV3'
import { TeamRoster } from './TeamRoster'
import { TeamFixtures } from './TeamFixtures'

const SOURCE = 'snp'
const BASE_URL = 'https://padelnachos.com'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ season?: string }>
}

export const revalidate = 3600

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  if (!data) return { title: 'Team | Padel Nachos' }

  const t = await getTranslations({ locale, namespace: 'team' })
  const title = t('metaTitle', {
    team: data.team.name,
    competition: data.team.short_name ?? data.team.competition ?? '',
    season: data.season.label,
  })
  const description = t('metaDescription', {
    team: data.team.name,
    competition: data.team.competition ?? '',
    season: data.season.label,
    tiesWon: data.season.ties_won ?? 0,
    tiesPlayed: data.season.ties_played ?? 0,
    courtsWon: data.season.courts_won ?? 0,
    courtsLost: data.season.courts_lost ?? 0,
  })

  return {
    title: `${title} | Padel Nachos`,
    description,
    alternates: {
      canonical: `${BASE_URL}/${locale}/snp/${slug}`,
      languages: Object.fromEntries(
        ['en', 'es', 'pt', 'it', 'fr'].map(l => [l, `${BASE_URL}/${l}/snp/${slug}`]),
      ),
    },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function TeamPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  if (!data) notFound()

  const t = await getTranslations({ locale, namespace: 'team' })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: data.team.name,
    sport: 'Padel',
    ...(data.team.city ? { location: { '@type': 'Place', name: data.team.city } } : {}),
    ...(data.team.crest_url ? { logo: data.team.crest_url } : {}),
    member: data.roster.map(r => ({ '@type': 'Person', name: r.name })),
  }

  const totals: Array<{ label: string; value: string }> = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>

        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
            {data.team.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, color: MUTED, fontSize: 12 }}>
            {data.team.country && <FlagImage country={data.team.country} size={16} />}
            <span>{[data.team.competition, data.team.city].filter(Boolean).join(' · ')}</span>
          </div>
          <div style={{ fontSize: 11, color: ORANGE, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {t('seasonLabel')} {data.season.label}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            {totals.map(x => (
              <div key={x.label} style={{
                flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
                clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  {x.value}
                </div>
                <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                  {x.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 14px 0' }}>
          <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('squad')}
          </div>
          <TeamRoster roster={data.roster} />
        </div>

        <div style={{ padding: '20px 14px 0' }}>
          <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('rounds')}
          </div>
          <TeamFixtures fixtures={data.fixtures} roster={data.roster} />
        </div>

        {data.season.notes && (
          <div style={{ margin: '8px 14px 0', background: BG_CARD, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
              {t('methodNote')}
            </div>
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
          </div>
        )}
      </div>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5 && npm run build 2>&1 | tail -3`
Expected: sem erros; build conclui.

- [ ] **Step 3: Provar que é server-rendered**

Reinicie a 3007 com o build novo e:

Run: `curl -s http://localhost:3007/es/snp/blue-padel-mataro | grep -c "Blue Padel Mataró"`
Expected: um número maior que zero. **Zero significa que a página virou casca de cliente** e o objetivo de SEO se perdeu — é a verificação central desta task.

Run: `curl -s http://localhost:3007/es/snp/blue-padel-mataro | grep -o "SportsTeam"`
Expected: `SportsTeam`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3007/es/snp/nao-existe`
Expected: `404`

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/snp/[slug]/page.tsx"
git commit -m "feat(team): server-rendered team page at /snp/[slug]"
```

---

## Task 9: Sitemap das equipes

**Files:**
- Create: `src/app/sitemap-teams.xml/route.ts`
- Modify: `src/app/sitemap.xml/route.ts`

- [ ] **Step 1: Criar o sitemap filho**

```ts
// src/app/sitemap-teams.xml/route.ts
// Child sitemap — team pages. One entry per team, expanded across the five
// locales with hreflang alternates, mirroring sitemap-players.xml.

import { createAnonServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const supabase = createAnonServerClient()

  const { data, error } = await supabase
    .from('teams')
    .select('slug')
    .eq('source', 'snp')

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).flatMap(t =>
    expandPathForLocales(BASE_URL, `/snp/${t.slug}`, {
      changefreq: 'weekly',
      priority: 0.6,
    }),
  )

  return xmlResponse(buildUrlSet(urls), revalidate)
}
```

- [ ] **Step 2: Registrar no índice**

Em `src/app/sitemap.xml/route.ts`, acrescente à lista de `buildSitemapIndex`:

```ts
    { loc: `${BASE_URL}/sitemap-teams.xml`, lastmod: now },
```

- [ ] **Step 3: Verificar**

Run: `curl -s http://localhost:3007/sitemap-teams.xml | grep -c "snp/blue-padel-mataro"`
Expected: `5` — uma entrada por locale.

Run: `curl -s http://localhost:3007/sitemap.xml | grep -c "sitemap-teams.xml"`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add src/app/sitemap-teams.xml/route.ts src/app/sitemap.xml/route.ts
git commit -m "feat(seo): team sitemap"
```

---

## Task 10: Aba Equipe vira resumo

**Files:**
- Modify: `src/app/[locale]/player/[id]/amateur/TeamTab.tsx`

- [ ] **Step 1: Substituir o conteúdo**

O arquivo tem 115 linhas hoje e cai para cerca de 60. Todo o conteúdo removido — elenco e jornadas — já vive em `TeamRoster.tsx` e `TeamFixtures.tsx`, usados pela página; nada é perdido.

```tsx
'use client'
// src/app/[locale]/player/[id]/amateur/TeamTab.tsx
// Collapsed summary of the player's team. The squad and the round-by-round
// calendar moved to /snp/[slug] — they were the club's whole record sitting
// inside one person's profile.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

export function TeamTab({ data }: { data: AmateurProfileData }) {
  const t = useTranslations('team')
  // Starts collapsed: the tab holds a single card, so opening it expanded
  // would make the control decorative.
  const [open, setOpen] = useState(false)

  const totals: Array<{ label: string; value: string }> = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  return (
    <div style={{ padding: '10px 14px 20px' }}>
      <div style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            width: '100%', textAlign: 'left', background: 'none', border: 'none',
            padding: '12px 13px', cursor: 'pointer', color: 'inherit', font: 'inherit',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{data.team.name}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              {[data.team.competition, data.team.city, data.season.label].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span style={{
            color: ORANGE, fontSize: 12, flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
          }}>
            ▾
          </span>
        </button>

        {open && (
          <div style={{ padding: '0 13px 13px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {totals.map(x => (
                <div key={x.label} style={{ flex: 1, background: '#1A1A1A', padding: '8px 5px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                    {x.value}
                  </div>
                  <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>
                    {x.label}
                  </div>
                </div>
              ))}
            </div>

            <Link
              href={`/snp/${data.team.slug}` as Parameters<typeof Link>[0]['href']}
              style={{
                display: 'inline-block', marginTop: 12, fontSize: 11, fontWeight: 700,
                color: ORANGE, textDecoration: 'none',
              }}
            >
              {t('viewTeam')} ›
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Ajustar o chamador**

`AmateurProfile.tsx` passa hoje `currentPlayerId` para o `TeamTab`. A prop some. Confirme e ajuste:

Run: `grep -n "TeamTab" "src/app/[locale]/player/[id]/AmateurProfile.tsx"`

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npm run lint 2>&1 | grep -c "TeamTab" ; npm run build 2>&1 | tail -2`
Expected: sem erros novos; build conclui.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/amateur/TeamTab.tsx" "src/app/[locale]/player/[id]/AmateurProfile.tsx"
git commit -m "feat(amateur): team tab becomes a collapsed summary linking to the team page"
```

---

## Task 11: Verificação com build de produção

**Files:** nenhum — verificação.

- [ ] **Step 1: Build e start**

```bash
npm run build && npx next start -p 3007
```

- [ ] **Step 2: A página de equipe**

Abra `http://localhost:3007/es/snp/blue-padel-mataro`. Confirme: cabeçalho com nome, competição, cidade, bandeira e temporada; os três totais (3/9, 20–25, 46–62); os 24 do elenco com os três sem jogos marcados; as 11 jornadas com as pistas e os avisos de dupla incerta; a nota de método. Repita em `/pt/` e sem prefixo.

- [ ] **Step 3: A aba Equipe**

Em `/es/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0`, aba Equipe: um card recolhido. Expanda, confira os três números, e clique em "Ver a equipe completa" — deve levar a `/es/snp/blue-padel-mataro`, mantendo o locale.

- [ ] **Step 4: A raquete**

No mesmo perfil, aba Resumo: o card da Babolat Air Viper 2025. Abra o perfil de outro amador e confirme que não há card nem buraco.

- [ ] **Step 5: O afiliado não quebrou**

No perfil do Tapia (`/es/player/c95d2602-fb24-4b4b-9c60-40a0950a4eae`), clique no botão da raquete e confirme no painel de rede que o `POST /api/racket-click` sai. Era o risco central da extração.

- [ ] **Step 6: Console e rede**

`read_console_messages` e `read_network_requests`: sem erros, sem 4xx/5xx do Supabase.

- [ ] **Step 7: Suíte**

Run: `npx vitest run src/lib/__tests__/ 2>&1 | grep -E "Tests|Test Files"`
Expected: verde nos arquivos amateur/team.

- [ ] **Step 8: Screenshot**

Da página de equipe e do card resumido, para o operador.
