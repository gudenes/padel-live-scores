# Rankings SSR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/rankings` from a `'use client'` page to a server component with small client islands so the top-100 ranking table, player anchors, country names, and an intro paragraph ship in the initial server HTML across all 5 locales (en/es/pt/it/fr).

**Architecture:** Server `page.tsx` fetches top-100 men's-official rows in parallel with the latest `ranking_date`, renders a static `<RankingsTable>` HTML, emits an ItemList JSON-LD, and mounts a small `<RankingsInteractive>` client island that owns toggle/search/show-more/follow state. ISR caches the response for 1h. Same HTML to every user.

**Tech Stack:** Next.js 16.2 (App Router, server components, ISR), TypeScript 5, Supabase JS (server + browser), next-intl (i18n + server formatters), Intl.DisplayNames (locale-aware country names), vitest (pure-function unit tests).

**Spec:** [docs/superpowers/specs/2026-05-20-rankings-ssr-design.md](../specs/2026-05-20-rankings-ssr-design.md)

**Branch:** Work continues on the current feature branch (`claude/friendly-bell-b41646`). Final integration is a single PR.

---

## File Structure

```
src/app/[locale]/(app)/rankings/
├── layout.tsx                — modify: add sr-only h1 wrapper (Task 9)
├── page.tsx                  — REWRITE: server component (Task 8)
├── shared.ts                 — NEW: types, Intl-based helpers, RankBadge, DeltaChip (Task 2)
├── shared.test.ts            — NEW: vitest tests for the Intl helpers (Task 2)
├── jsonld.ts                 — NEW: buildRankingsJsonLd() pure fn (Task 3)
├── jsonld.test.ts            — NEW: vitest tests (Task 3)
├── RankingsTable.tsx         — NEW: presentational table (Task 4)
├── FilterPills.tsx           — NEW: client (Task 5)
├── SearchModal.tsx           — NEW: client (Task 6)
└── RankingsInteractive.tsx   — NEW: client orchestrator (Task 7)

src/messages/{en,es,pt,it,fr}.json — modify: add rankings.intro.* + seo.rankings.jsonld_name (Task 1)
src/app/sitemap-static.xml/route.ts — modify: emit /rankings × 5 locales (Task 10)
```

Each new file has a single responsibility. `shared.ts` holds presentational primitives and helpers reused by both server (RankingsTable) and client (RankingsInteractive, SearchModal) without dragging the whole orchestrator into a server bundle.

---

### Task 1: Add translation strings for intro paragraphs and JSON-LD name

The downstream tasks reference `rankings.intro.{men_official|men_race|women_official|women_race}`, `rankings.empty`, and `seo.rankings.jsonld_name`. Adding the keys first means subsequent tasks compile without a translation-missing flicker.

Per user memory: 5 locales required (en/es/pt/it/fr). Intro paragraphs aim for 60–120 words each, locale-keyword-rich. Do not use emojis anywhere in the copy.

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the keys to `en.json`**

Locate the existing `seo.rankings` namespace and add `jsonld_name`. Add a new top-level `rankings` namespace.

```json
"seo": {
  "rankings": {
    "title": "Padel Rankings — FIP & Premier Padel",
    "description": "Official FIP and race padel rankings. Follow the world's top men's and women's players with live updates.",
    "jsonld_name": "FIP Men's Padel Rankings"
  }
}
```

```json
"rankings": {
  "empty": "Rankings will appear here once published.",
  "intro": {
    "men_official": "Follow the official FIP men's padel ranking, updated weekly. Each player's points reflect their best results across Premier Padel P1, P2, Major, and FIP Tour events over the past 52 weeks. The leaderboard below tracks the world No. 1 race in men's professional padel — from Coello and Tapia at the top down through the top 100.",
    "men_race": "The FIP race ranking shows the current-season points table for men's padel. Unlike the official ranking, race points reset every January and only count results from the current year. It's the live picture of who is performing best right now on the Premier Padel circuit.",
    "women_official": "The official FIP women's padel ranking is updated weekly and reflects each player's best results over the past 52 weeks. The leaderboard tracks the world No. 1 race in women's professional padel across Premier Padel and FIP Tour events.",
    "women_race": "The FIP race ranking for women's padel shows the current-season points table. Race points reset every January and only count results from the current year — it's the real-time picture of who is winning the season on the women's professional tour."
  }
}
```

- [ ] **Step 2: Add the same keys to `es.json` (Spanish)**

```json
"seo": {
  "rankings": {
    "title": "Clasificación de pádel — FIP y Premier Padel",
    "description": "Clasificación oficial FIP y ranking race de pádel. Sigue a los mejores jugadores y jugadoras del mundo con actualizaciones en directo.",
    "jsonld_name": "Ranking FIP de pádel masculino"
  }
}
```

```json
"rankings": {
  "empty": "El ranking aparecerá aquí cuando se publique.",
  "intro": {
    "men_official": "Sigue el ranking oficial FIP de pádel masculino, actualizado semanalmente. Los puntos de cada jugador reflejan sus mejores resultados en torneos Premier Padel P1, P2, Major y FIP Tour durante las últimas 52 semanas. La tabla inferior muestra la carrera por el número 1 mundial en el pádel profesional masculino, desde Coello y Tapia en la cima hasta los 100 mejores.",
    "men_race": "El ranking race FIP muestra la tabla de puntos de la temporada actual en pádel masculino. A diferencia del ranking oficial, los puntos race se reinician cada enero y solo cuentan los resultados del año en curso. Es la foto en directo de quién está rindiendo mejor en el circuito Premier Padel.",
    "women_official": "El ranking oficial FIP de pádel femenino se actualiza semanalmente y refleja los mejores resultados de cada jugadora durante las últimas 52 semanas. La tabla muestra la carrera por el número 1 mundial en el pádel profesional femenino en torneos Premier Padel y FIP Tour.",
    "women_race": "El ranking race FIP de pádel femenino muestra la tabla de puntos de la temporada actual. Los puntos race se reinician cada enero y solo cuentan los resultados del año en curso — es la foto en tiempo real de quién está ganando la temporada en el circuito profesional femenino."
  }
}
```

- [ ] **Step 3: Add the same keys to `pt.json` (Portuguese)**

```json
"seo": {
  "rankings": {
    "title": "Ranking de padel — FIP e Premier Padel",
    "description": "Ranking oficial FIP e ranking race de padel. Acompanha os melhores jogadores e jogadoras do mundo com atualizações em direto.",
    "jsonld_name": "Ranking FIP de padel masculino"
  }
}
```

```json
"rankings": {
  "empty": "O ranking aparecerá aqui quando for publicado.",
  "intro": {
    "men_official": "Acompanha o ranking oficial FIP de padel masculino, atualizado semanalmente. Os pontos de cada jogador refletem os seus melhores resultados em torneios Premier Padel P1, P2, Major e FIP Tour ao longo das últimas 52 semanas. A tabela mostra a corrida pelo número 1 mundial no padel profissional masculino, desde Coello e Tapia no topo até aos 100 melhores.",
    "men_race": "O ranking race FIP mostra a tabela de pontos da temporada atual no padel masculino. Ao contrário do ranking oficial, os pontos race são reiniciados todos os anos em janeiro e contam apenas os resultados do ano em curso. É a foto em direto de quem está a render mais no circuito Premier Padel.",
    "women_official": "O ranking oficial FIP de padel feminino é atualizado semanalmente e reflete os melhores resultados de cada jogadora ao longo das últimas 52 semanas. A tabela mostra a corrida pelo número 1 mundial no padel profissional feminino em torneios Premier Padel e FIP Tour.",
    "women_race": "O ranking race FIP de padel feminino mostra a tabela de pontos da temporada atual. Os pontos race são reiniciados todos os anos em janeiro e contam apenas os resultados do ano em curso — é a foto em tempo real de quem está a ganhar a temporada no circuito profissional feminino."
  }
}
```

- [ ] **Step 4: Add the same keys to `it.json` (Italian)**

```json
"seo": {
  "rankings": {
    "title": "Classifica padel — FIP e Premier Padel",
    "description": "Classifica ufficiale FIP e ranking race di padel. Segui i migliori giocatori e giocatrici del mondo con aggiornamenti in diretta.",
    "jsonld_name": "Classifica FIP padel maschile"
  }
}
```

```json
"rankings": {
  "empty": "La classifica apparirà qui una volta pubblicata.",
  "intro": {
    "men_official": "Segui la classifica ufficiale FIP del padel maschile, aggiornata settimanalmente. I punti di ogni giocatore riflettono i migliori risultati nei tornei Premier Padel P1, P2, Major e FIP Tour delle ultime 52 settimane. La tabella mostra la corsa al numero 1 del mondo nel padel professionistico maschile, da Coello e Tapia in cima fino ai migliori 100.",
    "men_race": "Il ranking race FIP mostra la tabella punti della stagione in corso nel padel maschile. A differenza della classifica ufficiale, i punti race si azzerano ogni gennaio e contano solo i risultati dell'anno in corso. È la foto in diretta di chi sta rendendo meglio nel circuito Premier Padel.",
    "women_official": "La classifica ufficiale FIP del padel femminile è aggiornata settimanalmente e riflette i migliori risultati di ogni giocatrice nelle ultime 52 settimane. La tabella mostra la corsa al numero 1 del mondo nel padel professionistico femminile nei tornei Premier Padel e FIP Tour.",
    "women_race": "Il ranking race FIP del padel femminile mostra la tabella punti della stagione in corso. I punti race si azzerano ogni gennaio e contano solo i risultati dell'anno in corso — è la foto in tempo reale di chi sta vincendo la stagione nel circuito professionistico femminile."
  }
}
```

- [ ] **Step 5: Add the same keys to `fr.json` (French)**

```json
"seo": {
  "rankings": {
    "title": "Classement padel — FIP et Premier Padel",
    "description": "Classement officiel FIP et ranking race de padel. Suivez les meilleurs joueurs et joueuses du monde en direct.",
    "jsonld_name": "Classement FIP padel masculin"
  }
}
```

```json
"rankings": {
  "empty": "Le classement apparaîtra ici une fois publié.",
  "intro": {
    "men_official": "Suivez le classement officiel FIP du padel masculin, mis à jour chaque semaine. Les points de chaque joueur reflètent leurs meilleurs résultats lors des tournois Premier Padel P1, P2, Major et FIP Tour au cours des 52 dernières semaines. Le tableau montre la course à la place de numéro 1 mondial dans le padel professionnel masculin, de Coello et Tapia au sommet jusqu'aux 100 meilleurs.",
    "men_race": "Le ranking race FIP affiche le tableau des points de la saison en cours dans le padel masculin. Contrairement au classement officiel, les points race sont remis à zéro chaque janvier et ne comptent que les résultats de l'année en cours. C'est la photo en direct de qui performe le mieux sur le circuit Premier Padel.",
    "women_official": "Le classement officiel FIP du padel féminin est mis à jour chaque semaine et reflète les meilleurs résultats de chaque joueuse sur les 52 dernières semaines. Le tableau montre la course à la place de numéro 1 mondial dans le padel professionnel féminin sur les tournois Premier Padel et FIP Tour.",
    "women_race": "Le ranking race FIP du padel féminin affiche le tableau des points de la saison en cours. Les points race sont remis à zéro chaque janvier et ne comptent que les résultats de l'année en cours — c'est la photo en temps réel de qui gagne la saison sur le circuit professionnel féminin."
  }
}
```

- [ ] **Step 6: Run the build to confirm no JSON syntax errors**

Run: `npm run build 2>&1 | head -40`
Expected: build proceeds past message-file loading without "Unexpected token" or "Invalid JSON" errors. If it surfaces missing-key errors elsewhere, that's the existing baseline — only fail this step on syntax errors in the files you touched.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(rankings): add intro paragraphs and JSON-LD name strings for 5 locales

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create `shared.ts` with types + Intl-based country helper + RankBadge + DeltaChip

Extract the presentational primitives from the existing 594-line page.tsx into a single file consumable from both server (`RankingsTable`) and client (`RankingsInteractive`, `SearchModal`). Replace the hardcoded English `COUNTRY_NAMES` map with `Intl.DisplayNames`.

**Files:**
- Create: `src/app/[locale]/(app)/rankings/shared.ts`
- Test: `src/app/[locale]/(app)/rankings/shared.test.ts`

- [ ] **Step 1: Write the failing tests for `countryNameForLocale` and `countryFlagUrl`**

Create `src/app/[locale]/(app)/rankings/shared.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countryNameForLocale, countryFlagUrl } from './shared'

describe('countryNameForLocale', () => {
  it('returns localized name for ISO3 code in English', () => {
    expect(countryNameForLocale('ESP', 'en')).toBe('Spain')
  })

  it('returns localized name for ISO3 code in Spanish', () => {
    expect(countryNameForLocale('ESP', 'es')).toBe('España')
  })

  it('returns localized name for ISO2 code', () => {
    expect(countryNameForLocale('ES', 'es')).toBe('España')
  })

  it('returns localized name in Portuguese', () => {
    expect(countryNameForLocale('BRA', 'pt')).toBe('Brasil')
  })

  it('returns "Unknown" for null input', () => {
    expect(countryNameForLocale(null, 'en')).toBe('Unknown')
  })

  it('falls back to raw code when Intl cannot resolve it', () => {
    expect(countryNameForLocale('ZZZ', 'en')).toBe('ZZZ')
  })
})

describe('countryFlagUrl', () => {
  it('maps ISO3 to lowercase ISO2 flag path', () => {
    expect(countryFlagUrl('ESP')).toBe('/flags/es.png')
  })

  it('passes through ISO2 lowercased', () => {
    expect(countryFlagUrl('AR')).toBe('/flags/ar.png')
  })

  it('returns null for null input', () => {
    expect(countryFlagUrl(null)).toBeNull()
  })

  it('returns null for unknown ISO3', () => {
    expect(countryFlagUrl('ZZZ')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/app/\[locale\]/\(app\)/rankings/shared.test.ts`
Expected: FAIL — `shared.ts` does not export `countryNameForLocale` or `countryFlagUrl`.

- [ ] **Step 3: Create `shared.ts` with types, helpers, and presentational components**

Create `src/app/[locale]/(app)/rankings/shared.ts`:

```tsx
// src/app/[locale]/(app)/rankings/shared.ts
// Presentational primitives and pure helpers reused by RankingsTable
// (server), RankingsInteractive (client), and SearchModal (client).

import type { ReactNode } from 'react'

// ── Brand colors ───────────────────────────────────────────────
export const GREEN = '#7ED321'
export const GREEN_DIM = 'rgba(126,211,33,0.15)'
export const ORANGE = '#F5A623'
export const BG_BASE = '#1A1A1A'
export const BG_CARD = '#141414'
export const MUTED = '#6B7280'
export const BORDER = 'rgba(255,255,255,0.06)'
export const MEN_BLUE = '#4A9EFF'
export const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets ───────────────────────────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
} as const

// ── Types ──────────────────────────────────────────────────────
export type RankType = 'official' | 'race'
export type Gender = 'men' | 'women'

export interface Player {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  points: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  avatar_url: string | null
  category: string | null
  updated_at: string | null
  ranking_date: string | null
}

// ── ISO3 → ISO2 (subset that has flag PNGs in /public/flags) ──
const ISO3_TO_2: Record<string, string> = {
  ESP: 'es', ARG: 'ar', BRA: 'br', POR: 'pt', FRA: 'fr', ITA: 'it',
  BEL: 'be', NLD: 'nl', GER: 'de', GBR: 'gb', DEN: 'dk', SWE: 'se',
  URU: 'uy', PAR: 'py', CHI: 'cl', MEX: 'mx', USA: 'us', AUS: 'au',
}

// Cache one Intl.DisplayNames instance per locale to avoid re-allocation.
const displayNamesCache = new Map<string, Intl.DisplayNames>()
function getDisplayNames(locale: string): Intl.DisplayNames {
  let dn = displayNamesCache.get(locale)
  if (!dn) {
    dn = new Intl.DisplayNames([locale], { type: 'region' })
    displayNamesCache.set(locale, dn)
  }
  return dn
}

/**
 * Resolve a country code to a localized name. Accepts ISO2 or ISO3.
 * Falls back to the raw code if Intl can't resolve it (e.g. 'ZZZ').
 */
export function countryNameForLocale(code: string | null, locale: string): string {
  if (!code) return 'Unknown'
  const upper = code.toUpperCase()
  const iso2 = upper.length === 3 ? ISO3_TO_2[upper] : upper.length === 2 ? upper.toLowerCase() : null
  const dn = getDisplayNames(locale)
  try {
    if (iso2) {
      const resolved = dn.of(iso2.toUpperCase())
      if (resolved && resolved !== iso2.toUpperCase()) return resolved
    }
    const resolved = dn.of(upper)
    if (resolved && resolved !== upper) return resolved
  } catch {
    // Intl threw on invalid code — fall through to raw
  }
  return upper
}

/** Path to a flag PNG in /public/flags, or null when unknown. */
export function countryFlagUrl(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  const iso2 = ISO3_TO_2[upper] ?? (upper.length === 2 ? upper.toLowerCase() : null)
  if (!iso2) return null
  return `/flags/${iso2}.png`
}

// ── Presentational primitives ──────────────────────────────────

export function RankBadge({ rank }: { rank: number | null }): ReactNode {
  if (!rank) {
    return <span style={{ color: MUTED, fontSize: 14 }}>--</span>
  }
  const isTop3 = rank <= 3
  const color = rank === 1 ? '#F5A623' : rank === 2 ? '#94A3B8' : rank === 3 ? '#CD7F32' : GREEN
  return (
    <span style={{
      fontWeight: 800, fontSize: isTop3 ? 17 : 15,
      color,
      display: 'block', textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {rank}
    </span>
  )
}

export function DeltaChip({ delta }: { delta: number }): ReactNode {
  if (delta === 0) {
    return <span style={{ fontSize: 9, color: MUTED, fontWeight: 600, lineHeight: 1 }}>--</span>
  }
  const up = delta > 0
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, lineHeight: 1,
      color: up ? GREEN : '#FF4655',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  )
}
```

Note: `shared.ts` uses TSX syntax (RankBadge returns JSX) but is named `.ts` — rename to `.tsx` if your build complains. Or split helpers into `shared.ts` and components into `shared-ui.tsx`. The plan keeps them together for fewer files; rename if needed.

- [ ] **Step 4: Rename to `.tsx` if Step 3 added JSX content**

Run: `mv src/app/\[locale\]/\(app\)/rankings/shared.ts src/app/\[locale\]/\(app\)/rankings/shared.tsx` if the file contains JSX. Update the test's import to `from './shared'` (extension-less imports still resolve via Next's bundler).

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run src/app/\[locale\]/\(app\)/rankings/shared.test.ts`
Expected: PASS — 10 tests passing.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/shared.tsx' 'src/app/[locale]/(app)/rankings/shared.test.ts'
git commit -m "feat(rankings): extract shared types, Intl country helper, and primitives

Replaces hardcoded English COUNTRY_NAMES map with locale-aware
Intl.DisplayNames lookup. Adds vitest coverage for the helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create `jsonld.ts` (pure function) with TDD

Builds the ItemList JSON-LD shape for the rankings page. Server-only import. Pure function, fully tested.

**Files:**
- Create: `src/app/[locale]/(app)/rankings/jsonld.ts`
- Test: `src/app/[locale]/(app)/rankings/jsonld.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/[locale]/(app)/rankings/jsonld.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRankingsJsonLd } from './jsonld'
import type { Player } from './shared'

const PLAYERS: Pick<Player, 'id' | 'name' | 'ranking' | 'country'>[] = [
  { id: 'p1', name: 'Arturo Coello', ranking: 1, country: 'ESP' },
  { id: 'p2', name: 'Agustín Tapia', ranking: 2, country: 'ARG' },
]

describe('buildRankingsJsonLd', () => {
  it('returns an ItemList with @context schema.org', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: "FIP Men's Padel Rankings",
    })
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('ItemList')
  })

  it('sets inLanguage to the active locale', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'es',
      baseUrl: 'https://padelnachos.com',
      listName: 'Ranking FIP de pádel masculino',
    })
    expect(ld.inLanguage).toBe('es')
    expect(ld.name).toBe('Ranking FIP de pádel masculino')
  })

  it('emits one item per player, with rank and a Person sub-entity', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement).toHaveLength(2)
    expect(ld.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'https://padelnachos.com/player/p1',
      item: {
        '@type': 'Person',
        name: 'Arturo Coello',
        nationality: 'ESP',
      },
    })
  })

  it('prefixes player URLs with the locale for non-English', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'pt',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement[0].url).toBe('https://padelnachos.com/pt/player/p1')
  })

  it('omits nationality field when player.country is null', () => {
    const ld = buildRankingsJsonLd({
      players: [{ id: 'p3', name: 'X', ranking: 3, country: null } as Player],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement[0].item).toEqual({
      '@type': 'Person',
      name: 'X',
    })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/app/\[locale\]/\(app\)/rankings/jsonld.test.ts`
Expected: FAIL — `jsonld.ts` does not exist.

- [ ] **Step 3: Implement `jsonld.ts`**

Create `src/app/[locale]/(app)/rankings/jsonld.ts`:

```ts
// src/app/[locale]/(app)/rankings/jsonld.ts
// Pure builder for the schema.org ItemList JSON-LD emitted on the
// rankings page. Server-only consumer (page.tsx); no runtime deps.

import type { Player } from './shared'

type LdPerson = {
  '@type': 'Person'
  name: string
  nationality?: string
}

type LdListItem = {
  '@type': 'ListItem'
  position: number
  url: string
  item: LdPerson
}

export type RankingsJsonLd = {
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  inLanguage: string
  name: string
  itemListElement: LdListItem[]
}

interface BuildInput {
  players: Player[]
  locale: string
  baseUrl: string
  listName: string
}

export function buildRankingsJsonLd({
  players,
  locale,
  baseUrl,
  listName,
}: BuildInput): RankingsJsonLd {
  const localePrefix = locale === 'en' ? '' : `/${locale}`

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    inLanguage: locale,
    name: listName,
    itemListElement: players.map((p, idx) => {
      const item: LdPerson = {
        '@type': 'Person',
        name: p.name,
      }
      if (p.country) item.nationality = p.country
      return {
        '@type': 'ListItem',
        position: p.ranking ?? idx + 1,
        url: `${baseUrl}${localePrefix}/player/${p.id}`,
        item,
      }
    }),
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run src/app/\[locale\]/\(app\)/rankings/jsonld.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/jsonld.ts' 'src/app/[locale]/(app)/rankings/jsonld.test.ts'
git commit -m "feat(rankings): add buildRankingsJsonLd pure fn for ItemList JSON-LD

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create `RankingsTable.tsx` (presentational, server-safe)

Pure presentational component. No state. Renders the table HTML with real `<Link href>` anchors per row. Imported by both `page.tsx` (server, initial render) and `RankingsInteractive` (client, post-toggle re-render).

**Files:**
- Create: `src/app/[locale]/(app)/rankings/RankingsTable.tsx`

- [ ] **Step 1: Implement the component**

Create `src/app/[locale]/(app)/rankings/RankingsTable.tsx`:

```tsx
// src/app/[locale]/(app)/rankings/RankingsTable.tsx
// Presentational rankings table. Renderable from both server (initial
// SSR) and client (post-toggle re-render). No useState/useRouter.

import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import FollowButton from '@/components/FollowButton'
import {
  BG_CARD, BORDER, CHUNKY, MUTED, GREEN,
  countryNameForLocale, countryFlagUrl,
  RankBadge, DeltaChip,
  type Player, type RankType,
} from './shared'

type Props = {
  players: Player[]
  rankType: RankType
  locale: string
  visibleCount?: number
}

export function RankingsTable({ players, rankType, locale, visibleCount }: Props) {
  const rows = visibleCount ? players.slice(0, visibleCount) : players
  return (
    <div style={{
      background: BG_CARD,
      clipPath: CHUNKY.card,
      borderTop: `1px solid ${BORDER}`,
    }}>
      {rows.map((p) => {
        const rank = rankType === 'official' ? p.ranking : p.race_ranking
        const points = rankType === 'official' ? p.points : p.race_points
        const move = rankType === 'official' ? p.ranking_move : p.race_move
        const flag = countryFlagUrl(p.country)
        const country = countryNameForLocale(p.country, locale)
        return (
          <Link
            key={p.id}
            href={`/player/${p.id}`}
            prefetch={false}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr auto auto auto',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: `1px solid ${BORDER}`,
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            <RankBadge rank={rank} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {p.avatar_url ? (
                <Image
                  src={p.avatar_url}
                  alt=""
                  width={32}
                  height={32}
                  style={{ borderRadius: '50%', objectFit: 'cover' }}
                  unoptimized
                />
              ) : (
                <span style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: BORDER, display: 'inline-block',
                }} aria-hidden />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </span>
                <span style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {flag && (
                    <Image src={flag} alt="" width={12} height={9} style={{ display: 'inline-block' }} unoptimized />
                  )}
                  {country}
                </span>
              </div>
            </div>
            <span style={{
              fontVariantNumeric: 'tabular-nums',
              fontSize: 13, color: '#fff', fontWeight: 600,
            }}>
              {points?.toLocaleString(locale) ?? '--'}
            </span>
            <DeltaChip delta={move ?? 0} />
            <FollowButton playerId={p.id} compact />
          </Link>
        )
      })}
    </div>
  )
}
```

Note: this component imports `FollowButton`. `FollowButton` is `'use client'`, which Next.js handles automatically at the boundary — the `<RankingsTable>` itself stays server-renderable. Per-row follow buttons mount as client islands.

The `compact` prop on `FollowButton` may not exist today; if it doesn't, omit the prop and let the component use defaults. Verify by reading `src/components/FollowButton.tsx` first.

- [ ] **Step 2: Verify the import resolves and the file compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/RankingsTable" | head -20`
Expected: empty output (no type errors).

If `FollowButton`'s `compact` prop doesn't exist, remove the `compact` prop and retry.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/RankingsTable.tsx'
git commit -m "feat(rankings): add RankingsTable presentational component

Server-renderable table with Link anchors per row, locale-aware
country names, and FollowButton islands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create `FilterPills.tsx` (client island)

Pill row for gender + rank-type toggle, with swipe handlers. Controlled component (parent owns state).

**Files:**
- Create: `src/app/[locale]/(app)/rankings/FilterPills.tsx`

- [ ] **Step 1: Implement the component**

Create `src/app/[locale]/(app)/rankings/FilterPills.tsx`:

```tsx
'use client'
// src/app/[locale]/(app)/rankings/FilterPills.tsx
// Two-row pill toggle (gender, rank type) with swipe handlers.

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useSwipeTabs } from '@/hooks/useSwipeTabs'
import {
  CHUNKY, BG_CARD, BORDER, GREEN, MUTED, MEN_BLUE, WOMEN_PURPLE,
  type RankType, type Gender,
} from './shared'

type Props = {
  rankType: RankType
  gender: Gender
  onChange: (next: { rankType: RankType; gender: Gender }) => void
}

export function FilterPills({ rankType, gender, onChange }: Props) {
  const t = useTranslations('rankings')

  const tabs = useMemo(() => ['men:official', 'men:race', 'women:official', 'women:race'] as const, [])
  const currentTab = `${gender}:${rankType}` as typeof tabs[number]
  const currentIndex = tabs.indexOf(currentTab)

  const { handlers: swipeHandlers } = useSwipeTabs({
    count: tabs.length,
    index: currentIndex,
    goTo: (next: number) => {
      const [g, rt] = tabs[next].split(':') as [Gender, RankType]
      onChange({ gender: g, rankType: rt })
    },
  })

  const pill = (active: boolean, color: string): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: active ? '#000' : color,
    background: active ? color : 'transparent',
    border: `1.5px solid ${color}`,
    clipPath: CHUNKY.button,
    cursor: 'pointer',
  })

  return (
    <div {...swipeHandlers} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={pill(gender === 'men', MEN_BLUE)}
          onClick={() => onChange({ rankType, gender: 'men' })}
        >
          {t('men')}
        </button>
        <button
          type="button"
          style={pill(gender === 'women', WOMEN_PURPLE)}
          onClick={() => onChange({ rankType, gender: 'women' })}
        >
          {t('women')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={pill(rankType === 'official', GREEN)}
          onClick={() => onChange({ rankType: 'official', gender })}
        >
          {t('official')}
        </button>
        <button
          type="button"
          style={pill(rankType === 'race', GREEN)}
          onClick={() => onChange({ rankType: 'race', gender })}
        >
          {t('race')}
        </button>
      </div>
    </div>
  )
}
```

Note: this component uses `rankings.men`, `rankings.women`, `rankings.official`, `rankings.race` translation keys. Verify these exist in `src/messages/en.json` under the `rankings` namespace from Task 1. If they don't, add them now to all 5 message files:

```json
"rankings": {
  "men": "Men",
  "women": "Women",
  "official": "Official",
  "race": "Race",
  ...
}
```

With Spanish, Portuguese, Italian, French equivalents: Hombres/Mujeres/Oficial/Race · Homens/Mulheres/Oficial/Race · Uomini/Donne/Ufficiale/Race · Hommes/Femmes/Officiel/Race.

- [ ] **Step 2: Verify the `useSwipeTabs` hook signature matches**

Read: `src/hooks/useSwipeTabs.ts` — confirm the hook accepts `{ count, index, goTo }`. If the actual signature differs, adjust the `FilterPills` call site accordingly.

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/FilterPills" | head -20`
Expected: empty output.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/FilterPills.tsx' src/messages/*.json
git commit -m "feat(rankings): add FilterPills client island with swipe handlers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create `SearchModal.tsx` (client island)

Search overlay reused from the existing rankings page. Self-contained — receives the player list and emits selections via callback.

**Files:**
- Create: `src/app/[locale]/(app)/rankings/SearchModal.tsx`

- [ ] **Step 1: Read the existing search modal implementation from the old page**

The existing `src/app/[locale]/(app)/rankings/page.tsx` contains a search modal section between the filter pills and the table. Locate it (search for `searchOpen` and `query` state usage) and extract its JSX + filtering logic.

- [ ] **Step 2: Implement the extracted component**

Create `src/app/[locale]/(app)/rankings/SearchModal.tsx`:

```tsx
'use client'
// src/app/[locale]/(app)/rankings/SearchModal.tsx
// Player search overlay. Filters the full player list client-side.

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  BG_BASE, BG_CARD, BORDER, MUTED, GREEN,
  countryNameForLocale, countryFlagUrl,
  RankBadge,
  type Player, type RankType,
} from './shared'

type Props = {
  players: Player[]
  rankType: RankType
  locale: string
  onClose: () => void
}

export function SearchModal({ players, rankType, locale, onClose }: Props) {
  const t = useTranslations('rankings')
  const router = useRouter()
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players.slice(0, 50)
    return players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 50)
  }, [query, players])

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: BG_BASE,
        display: 'flex', flexDirection: 'column', zIndex: 100,
      }}
    >
      <div style={{ padding: 12, borderBottom: `1px solid ${BORDER}`, display: 'flex', gap: 8 }}>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          style={{
            flex: 1, background: BG_CARD, color: '#fff',
            border: `1px solid ${BORDER}`, padding: '8px 12px',
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'transparent', color: MUTED, border: 'none', fontSize: 14 }}
        >
          {t('close')}
        </button>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {results.map((p) => {
          const rank = rankType === 'official' ? p.ranking : p.race_ranking
          const country = countryNameForLocale(p.country, locale)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                router.push(`/player/${p.id}`)
                onClose()
              }}
              style={{
                width: '100%', textAlign: 'left',
                display: 'grid', gridTemplateColumns: '44px 1fr', gap: 12,
                padding: '10px 12px', alignItems: 'center',
                background: 'transparent', color: '#fff',
                border: 'none', borderBottom: `1px solid ${BORDER}`,
                cursor: 'pointer',
              }}
            >
              <RankBadge rank={rank} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: MUTED }}>{country}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

Add translation keys to all 5 messages files (English, then translated):

```json
"rankings": {
  ...,
  "searchPlaceholder": "Search players...",
  "close": "Close"
}
```

Spanish: `Buscar jugadores...` / `Cerrar`. Portuguese: `Pesquisar jogadores...` / `Fechar`. Italian: `Cerca giocatori...` / `Chiudi`. French: `Rechercher des joueurs...` / `Fermer`.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/SearchModal" | head -20`
Expected: empty output.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/SearchModal.tsx' src/messages/*.json
git commit -m "feat(rankings): add SearchModal client island

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Create `RankingsInteractive.tsx` (client orchestrator)

The behavioural island. Owns rankType/gender/players/loading/visibleCount/search state. Receives initial server-fetched data via props, fetches the other 3 variants on demand, caches them, guards against rapid-toggle races, and schedules a background fetch for rows 101–1000 of the default variant.

**Files:**
- Create: `src/app/[locale]/(app)/rankings/RankingsInteractive.tsx`

- [ ] **Step 1: Implement the orchestrator**

Create `src/app/[locale]/(app)/rankings/RankingsInteractive.tsx`:

```tsx
'use client'
// src/app/[locale]/(app)/rankings/RankingsInteractive.tsx
// Owns toggle/search/show-more state. Initial state matches the
// SSR'd table so React reconciliation skips DOM mutations on mount.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { markRankingsVisited } from '@/hooks/useRankingsLastVisit'
import { formatYearWeek } from '@/lib/iso-year-week'
import { RankingsTable } from './RankingsTable'
import { FilterPills } from './FilterPills'
import { SearchModal } from './SearchModal'
import {
  BG_BASE, MUTED, GREEN,
  type Player, type RankType, type Gender,
} from './shared'

const PLAYER_COLUMNS = 'id, name, display_name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date'

type Props = {
  initialPlayers: Player[]
  initialRankingDateFormatted: string | null
  initialRankingDateISO: string | null
  locale: string
}

const variantKey = (g: Gender, rt: RankType) => `${g}:${rt}`

export function RankingsInteractive({
  initialPlayers,
  initialRankingDateFormatted,
  initialRankingDateISO,
  locale,
}: Props) {
  const t = useTranslations('rankings')

  // State matches SSR'd default (men/official) on first render.
  const [rankType, setRankType] = useState<RankType>('official')
  const [gender, setGender] = useState<Gender>('men')
  const [players, setPlayers] = useState<Player[]>(initialPlayers)
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)

  const cacheRef = useRef<Map<string, Player[]>>(new Map())
  const requestIdRef = useRef(0)

  // Seed cache with SSR'd data so toggling back to men/official is instant.
  useEffect(() => {
    cacheRef.current.set(variantKey('men', 'official'), initialPlayers)
  }, [initialPlayers])

  // Mark the user has seen this week's rankings.
  useEffect(() => {
    if (initialRankingDateISO) {
      markRankingsVisited(formatYearWeek(initialRankingDateISO))
    }
  }, [initialRankingDateISO])

  // Background-fetch rows 101–1000 of the default variant after hydration
  // so "Show more" doesn't hit the network.
  useEffect(() => {
    const key = variantKey('men', 'official')
    if (cacheRef.current.get(key)?.length === initialPlayers.length && initialPlayers.length < 1000) {
      const schedule = (cb: () => void) => {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(cb)
        } else {
          setTimeout(cb, 0)
        }
      }
      schedule(async () => {
        const { data } = await supabase
          .from('players')
          .select(PLAYER_COLUMNS)
          .eq('category', 'men')
          .not('ranking', 'is', null)
          .order('ranking', { ascending: true })
          .limit(1000)
        if (data) {
          const full = data as Player[]
          cacheRef.current.set(key, full)
          if (gender === 'men' && rankType === 'official') {
            setPlayers(full)
          }
        }
      })
    }
  }, [initialPlayers])

  const change = async (next: { rankType: RankType; gender: Gender }) => {
    if (next.rankType === rankType && next.gender === gender) return
    setRankType(next.rankType)
    setGender(next.gender)
    setVisibleCount(100)

    const key = variantKey(next.gender, next.rankType)
    const cached = cacheRef.current.get(key)
    if (cached) {
      setPlayers(cached)
      return
    }

    const myId = ++requestIdRef.current
    setLoading(true)
    const rankCol = next.rankType === 'official' ? 'ranking' : 'race_ranking'
    const { data } = await supabase
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('category', next.gender)
      .not(rankCol, 'is', null)
      .order(rankCol, { ascending: true })
      .limit(1000)

    // Discard the response if a later toggle has superseded this one.
    if (myId !== requestIdRef.current) return

    if (data) {
      const fetched = data as Player[]
      cacheRef.current.set(key, fetched)
      setPlayers(fetched)
    }
    setLoading(false)
  }

  const showMore = () => setVisibleCount((n) => Math.min(n + 100, players.length))

  return (
    <>
      <FilterPills rankType={rankType} gender={gender} onChange={change} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px', color: MUTED, fontSize: 12 }}>
        <span>
          {initialRankingDateFormatted ? `${t('updated')} ${initialRankingDateFormatted}` : ''}
        </span>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          style={{ background: 'transparent', color: GREEN, border: 'none', fontSize: 13, fontWeight: 700 }}
        >
          {t('searchAction')}
        </button>
      </div>

      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>{t('loading')}</div>
      )}

      {!loading && players.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>{t('empty')}</div>
      )}

      {!loading && players.length > 0 && (
        <RankingsTable
          players={players}
          rankType={rankType}
          locale={locale}
          visibleCount={visibleCount}
        />
      )}

      {!loading && visibleCount < players.length && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={showMore}
            style={{
              padding: '10px 20px',
              fontSize: 13, fontWeight: 800,
              color: '#000', background: GREEN, border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('showMore')}
          </button>
        </div>
      )}

      {searchOpen && (
        <SearchModal
          players={players}
          rankType={rankType}
          locale={locale}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  )
}
```

Add the remaining translation keys to all 5 message files under `rankings`:

```json
"rankings": {
  ...,
  "updated": "Updated",
  "searchAction": "Search",
  "loading": "Loading...",
  "showMore": "Show more"
}
```

Translations: ES `Actualizado / Buscar / Cargando... / Ver más` · PT `Atualizado / Pesquisar / A carregar... / Ver mais` · IT `Aggiornato / Cerca / Caricamento... / Mostra altri` · FR `Mis à jour / Rechercher / Chargement... / Voir plus`.

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/RankingsInteractive" | head -20`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/RankingsInteractive.tsx' src/messages/*.json
git commit -m "feat(rankings): add RankingsInteractive client island

Owns toggle/search/show-more state, variant cache, requestId race
guard, and idle-time background fetch for rows 101-1000.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Rewrite `page.tsx` as a server component

The orchestrator. Server-fetches top-100 men/official + ranking_date in parallel, renders the table HTML, emits JSON-LD, mounts the client island. ISR `revalidate = 3600`.

**Files:**
- Modify (full rewrite): `src/app/[locale]/(app)/rankings/page.tsx`

- [ ] **Step 1: Save the existing page.tsx as a reference, then rewrite**

The existing `page.tsx` is 594 lines. Most logic moves to `RankingsInteractive`. Replace the file contents entirely:

```tsx
// src/app/[locale]/(app)/rankings/page.tsx
// SSR rankings — server-renders top 100 men's official as static HTML,
// mounts <RankingsInteractive> for toggle/search/show-more state.

import { getTranslations, getFormatter } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { BG_BASE } from './shared'
import { RankingsTable } from './RankingsTable'
import { RankingsInteractive } from './RankingsInteractive'
import { buildRankingsJsonLd } from './jsonld'
import type { Player } from './shared'

export const revalidate = 3600

const BASE_URL = 'https://padelnachos.com'
const PLAYER_COLUMNS = 'id, name, display_name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date'

type Props = {
  params: Promise<{ locale: string }>
}

async function loadInitialData(): Promise<{ players: Player[]; rankingDateISO: string | null }> {
  let supabase
  try {
    supabase = createServerClient()
  } catch {
    return { players: [], rankingDateISO: null }
  }

  const [playersResult, dateResult] = await Promise.all([
    supabase
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('category', 'men')
      .not('ranking', 'is', null)
      .order('ranking', { ascending: true })
      .limit(100),
    supabase
      .from('players')
      .select('ranking_date')
      .not('ranking_date', 'is', null)
      .order('ranking_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const players = (playersResult.data ?? []) as Player[]
  const rankingDateISO = (dateResult.data?.ranking_date as string | null | undefined) ?? null
  return { players, rankingDateISO }
}

export default async function RankingsPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'rankings' })
  const tSeo = await getTranslations({ locale, namespace: 'seo.rankings' })
  const format = await getFormatter({ locale })

  const { players, rankingDateISO } = await loadInitialData()

  const rankingDateFormatted = rankingDateISO
    ? format.dateTime(new Date(rankingDateISO), { dateStyle: 'long' })
    : null

  const jsonLd = buildRankingsJsonLd({
    players,
    locale,
    baseUrl: BASE_URL,
    listName: tSeo('jsonld_name'),
  })

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <GlobalHeader />

      {/* Intro paragraph is sr-only — present in HTML for Googlebot
          and screen readers, hidden from sighted users. */}
      <p className="sr-only">{t('intro.men_official')}</p>

      {/* SSR'd table — same component the client uses post-toggle.
          Hidden once <RankingsInteractive> mounts (it renders its own
          copy with the same data, React reconciles in place). */}
      <noscript>
        <RankingsTable players={players} rankType="official" locale={locale} visibleCount={100} />
      </noscript>

      <RankingsInteractive
        initialPlayers={players}
        initialRankingDateFormatted={rankingDateFormatted}
        initialRankingDateISO={rankingDateISO}
        locale={locale}
      />
    </div>
  )
}
```

Wait — that `<noscript>` wrapper would hide the table from regular browsers. We want the table visible in the SSR'd HTML for Googlebot AND ungated for the user. The trick: the client `<RankingsInteractive>` re-renders its own `<RankingsTable>` with the same `initialPlayers`, so React reconciles in place and no DOM rewrite occurs. The SSR'd JSX from `page.tsx` is what `RankingsInteractive` renders too, which means we should NOT also render a separate `<RankingsTable>` from `page.tsx`. The orchestration sits entirely inside `RankingsInteractive`, and the server SSRs the same tree by running that component on the server.

Update the file — remove the `<noscript>` wrapper and the duplicate `<RankingsTable>`. `RankingsInteractive` is `'use client'`, but Next.js renders client components on the server too on first render. Its initial-state render IS the SSR output:

```tsx
// src/app/[locale]/(app)/rankings/page.tsx
// SSR rankings — server-renders top 100 men's official as static HTML
// via the client island's server-side render path.

import { getTranslations, getFormatter } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { BG_BASE } from './shared'
import { RankingsInteractive } from './RankingsInteractive'
import { buildRankingsJsonLd } from './jsonld'
import type { Player } from './shared'

export const revalidate = 3600

const BASE_URL = 'https://padelnachos.com'
const PLAYER_COLUMNS = 'id, name, display_name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date'

type Props = {
  params: Promise<{ locale: string }>
}

async function loadInitialData(): Promise<{ players: Player[]; rankingDateISO: string | null }> {
  let supabase
  try {
    supabase = createServerClient()
  } catch {
    return { players: [], rankingDateISO: null }
  }

  const [playersResult, dateResult] = await Promise.all([
    supabase
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('category', 'men')
      .not('ranking', 'is', null)
      .order('ranking', { ascending: true })
      .limit(100),
    supabase
      .from('players')
      .select('ranking_date')
      .not('ranking_date', 'is', null)
      .order('ranking_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const players = (playersResult.data ?? []) as Player[]
  const rankingDateISO = (dateResult.data?.ranking_date as string | null | undefined) ?? null
  return { players, rankingDateISO }
}

export default async function RankingsPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'rankings' })
  const tSeo = await getTranslations({ locale, namespace: 'seo.rankings' })
  const format = await getFormatter({ locale })

  const { players, rankingDateISO } = await loadInitialData()

  const rankingDateFormatted = rankingDateISO
    ? format.dateTime(new Date(rankingDateISO), { dateStyle: 'long' })
    : null

  const jsonLd = buildRankingsJsonLd({
    players,
    locale,
    baseUrl: BASE_URL,
    listName: tSeo('jsonld_name'),
  })

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <GlobalHeader />

      {/* Intro paragraph is sr-only — present in HTML for Googlebot
          and screen readers, hidden from sighted users. Keeps the
          mobile UI clean while preserving the keyword-density SEO win.
          Stays on intro.men_official regardless of client toggles
          (Google indexes the SSR'd default). */}
      <p className="sr-only">{t('intro.men_official')}</p>

      <RankingsInteractive
        initialPlayers={players}
        initialRankingDateFormatted={rankingDateFormatted}
        initialRankingDateISO={rankingDateISO}
        locale={locale}
      />
    </div>
  )
}
```

This works because:
1. Next.js renders client components on the server during initial render, producing static HTML.
2. The client component's initial state matches the props — its render output is deterministic and SSR-safe.
3. Browser fetches the HTML, then hydrates the same tree without DOM mutation.

The intro paragraph is rendered server-side directly (always reflects the SSR'd default variant `men_official`). When the user toggles, we accept that the intro stays the same — the JSON-LD and the visible intro reflect the SSR'd state, which is what Google indexes.

- [ ] **Step 2: Verify the file compiles and the imports resolve**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/page" | head -20`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/page.tsx'
git commit -m "feat(rankings): rewrite page.tsx as server component with ISR

Top-100 men/official + ranking_date fetched server-side in parallel.
JSON-LD ItemList emitted with inLanguage. Intro paragraph rendered
SSR. Client orchestration moves to RankingsInteractive. ISR 1h.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Update `layout.tsx` to add an `sr-only` `<h1>`

The existing layout has metadata but no `<h1>` element. Add one — sr-only is fine for SEO (Googlebot reads it; screen readers announce it; visual layout unaffected).

**Files:**
- Modify: `src/app/[locale]/(app)/rankings/layout.tsx`

- [ ] **Step 1: Modify the layout default export**

Open `src/app/[locale]/(app)/rankings/layout.tsx`. Replace the `RankingLayout` component:

```tsx
// src/app/[locale]/(app)/rankings/layout.tsx
// Localised metadata + sr-only h1 — reads "seo.rankings" from the active locale.

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'rankings', path: '/rankings' })
}

export default async function RankingLayout({ params, children }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'seo.rankings' })
  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      {children}
    </>
  )
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "rankings/layout" | head -10`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/rankings/layout.tsx'
git commit -m "feat(rankings): add sr-only h1 to layout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Add 5 locale variants of `/rankings` to `sitemap-static.xml`

Currently the static sitemap emits only the English `/rankings`. Add the four other locale URLs.

**Files:**
- Modify: `src/app/sitemap-static.xml/route.ts`

- [ ] **Step 1: Modify the sitemap route**

Open `src/app/sitemap-static.xml/route.ts`. Locate the line emitting `${BASE_URL}/rankings` and replace it with a loop over locales:

```ts
// src/app/sitemap-static.xml/route.ts
// Child sitemap — the handful of top-level marketing/index pages.

import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
const RANKINGS_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

export const revalidate = 3600

export async function GET() {
  const now = new Date().toISOString()

  const rankingsUrls: SitemapUrl[] = RANKINGS_LOCALES.map((loc) => ({
    loc: loc === 'en' ? `${BASE_URL}/rankings` : `${BASE_URL}/${loc}/rankings`,
    lastmod: now,
    changefreq: 'daily' as const,
    priority: 0.8,
  }))

  const urls: SitemapUrl[] = [
    { loc: BASE_URL, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/home`, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/matches`, lastmod: now, changefreq: 'always', priority: 0.9 },
    ...rankingsUrls,
    { loc: `${BASE_URL}/feed`, lastmod: now, changefreq: 'hourly', priority: 0.7 },
    { loc: `${BASE_URL}/about`, lastmod: now, changefreq: 'weekly', priority: 0.4 },
  ]

  return xmlResponse(buildUrlSet(urls), revalidate)
}
```

- [ ] **Step 2: Build and curl the sitemap locally to confirm the new URLs**

Run: `npm run build && npm run start &`
Wait for the server to be ready, then:
```bash
curl -s http://localhost:3000/sitemap-static.xml | grep -c '<loc>'
```
Expected: 9 (1 root + 1 home + 1 matches + 5 rankings + 1 feed + 1 about).

```bash
curl -s http://localhost:3000/sitemap-static.xml | grep '/rankings'
```
Expected: 5 lines, one per locale.

Kill the server when done.

- [ ] **Step 3: Commit**

```bash
git add src/app/sitemap-static.xml/route.ts
git commit -m "feat(seo): emit all 5 locale variants of /rankings in sitemap-static

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Local verification on the preview server

End-to-end check against the design's "Testing — Local verification" section. Use the preview tools workflow (see CLAUDE.md preview_* tools, never Bash for dev servers).

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Use `preview_start` to spin up the Next.js dev server. Confirm it boots without errors.

- [ ] **Step 2: View-source on each locale**

For each of `/rankings`, `/es/rankings`, `/pt/rankings`, `/it/rankings`, `/fr/rankings`:

Use `preview_eval` with:
```js
fetch(window.location.origin + '/rankings').then(r => r.text()).then(html => ({
  rowCount: (html.match(/href="\/player\//g) || []).length,
  hasH1: html.includes('<h1 class="sr-only">'),
  hasJsonLd: html.includes('"@type":"ItemList"'),
  introPresent: html.includes('FIP') && html.length > 30000,
}))
```
Adjust the URL per locale. Expected per locale: `rowCount >= 100`, `hasH1: true`, `hasJsonLd: true`, `introPresent: true`.

- [ ] **Step 3: Check console for hydration warnings**

Use `preview_console_logs` after the page settles. Expected: zero `Hydration failed` / `Warning: Text content did not match` messages.

- [ ] **Step 4: Test the filter toggle path**

Use `preview_click` on the "Women" pill. Use `preview_snapshot` to confirm the table swapped to women's data. Click "Men" — confirm instant return (cached). Click "Race" — confirm fetch + swap. Click "Official" — instant return.

- [ ] **Step 5: Test the "Show more" path**

After hydration completes and the idle-time fetch finishes (wait ~2s), use `preview_eval`:
```js
document.querySelectorAll('a[href^="/player/"]').length
```
Expected: 100 (the visible rows).

Use `preview_click` on the "Show more" button. Re-run the eval. Expected: 200 (`visibleCount` jumps by 100).

- [ ] **Step 6: Test the search modal**

Use `preview_click` on the "Search" button, `preview_fill` to type "Tapia", `preview_snapshot` to confirm filtered results render. `preview_click` on Tapia's row → confirm navigation to `/player/{id}`.

- [ ] **Step 7: Take screenshots for the PR description**

Use `preview_screenshot` on `/rankings` (English) and `/es/rankings` to attach to the PR.

- [ ] **Step 8: Final commit (if any housekeeping needed)**

If Step 1–7 surfaced no issues, no commit needed. Otherwise fix and commit.

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented by |
|---|---|
| Goal 1 (SEO-first HTML) | Tasks 2 (Intl country names), 4 (Link anchors), 7 (intro present in SSR), 8 (page.tsx renders all of above), 9 (sr-only h1) |
| Goal 2 (multi-locale parity) | Tasks 1 (translations × 5), 2 (Intl.DisplayNames), 8 (locale-aware date format), 10 (sitemap × 5) |
| Goal 3 (no UX regression) | Tasks 5–7 preserve filter/search/show-more; Task 11 verifies |
| Goal 4 (architecturally clean) | File structure split across Tasks 2–8 |
| Architecture: 7 new files | Tasks 2 (shared), 3 (jsonld), 4 (RankingsTable), 5 (FilterPills), 6 (SearchModal), 7 (RankingsInteractive), 8 (rewrites page) |
| Data flow: server fetches top-100 + ranking_date in parallel | Task 8 `Promise.all([...])` |
| Data flow: variant cache + requestId guard | Task 7 `cacheRef` + `requestIdRef` |
| Data flow: idle-time background fetch for rows 101–1000 | Task 7 `schedule()` block |
| Multi-locale: country names via Intl.DisplayNames | Task 2 `countryNameForLocale` |
| Multi-locale: locale-aware "Updated" date | Task 8 `format.dateTime(date, { dateStyle: 'long' })` |
| Multi-locale: sitemap × 5 locales | Task 10 |
| Multi-locale: JSON-LD inLanguage + localized name | Task 3 (`inLanguage` field) + Task 8 (`tSeo('jsonld_name')`) |
| Multi-locale: intro paragraph × 4 variants × 5 locales | Task 1 (translations) + Task 8 (renders intro.men_official SSR-side) |
| Error: Supabase server fetch failure | Task 8 `loadInitialData` returns empty arrays on throw |
| Error: empty result state | Task 7 renders `t('empty')` |
| Error: hydration mismatch on dates | Task 8 server-formats once, passes string |
| Testing | Tasks 2, 3 have vitest unit tests; Task 11 has manual preview verification |
| Rollout: single PR, no flag, atomic Vercel deploy | Implicit in the commit/PR flow at the end |

**Placeholder scan:**

I scanned the plan for "TBD", "TODO", "implement later", "fill in details", "add appropriate error handling", "similar to Task N", and "write tests for the above". The only occurrences are in instructional/cautionary copy in the plan itself (e.g., "verify by reading FollowButton.tsx first" in Task 4), not as deferred work. No placeholder code blocks.

**Type consistency:**

- `Player` defined in `shared.ts` (Task 2), imported consistently in Tasks 3, 4, 6, 7, 8.
- `RankType` / `Gender` defined in `shared.ts`, used identically downstream.
- `buildRankingsJsonLd` signature `({ players, locale, baseUrl, listName })` matches between Task 3 (definition + tests) and Task 8 (call site).
- `RankingsTable` props `{ players, rankType, locale, visibleCount? }` match between Task 4 (definition) and Task 7 (usage).
- `RankingsInteractive` props `{ initialPlayers, initialRankingDateFormatted, initialRankingDateISO, locale }` match between Task 7 (definition) and Task 8 (call site).
- `countryNameForLocale(code, locale)` signature is consistent across Tasks 2, 4, 6.
- `useSwipeTabs` invocation in Task 5 is a best-effort guess at the hook's shape; Task 5 Step 2 explicitly tells the implementer to verify the actual signature and adjust.
- `FollowButton`'s `compact` prop is unverified — Task 4 Step 1 notes this and Step 2 tells the implementer to drop the prop if it doesn't exist.

No type drift between tasks. Two callouts explicitly flagged to the implementer (hook signature + FollowButton prop) — these are unavoidable because the plan can't predict prop shapes without reading source the writer didn't read.
