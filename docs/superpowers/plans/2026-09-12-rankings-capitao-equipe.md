# Rankings, capitão e equipe sob o nome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o ranking zonal e o nacional do jogador amador, marcar o capitão da equipe, e trazer a equipe para a linha logo abaixo do nome.

**Architecture:** Os dois rankings e a capitania entram em `team_memberships`, que já é a linha por jogador e por temporada. O ID da SNP passa a ser guardado em `entity_external_ids`, e o import resolve por ID antes de cair no nome — hoje um acento corrigido na planilha criaria um jogador duplicado. No hero, o ranking zonal ocupa o chip que era do `competition_rank`, que é removido.

**Tech Stack:** Next.js 16, TypeScript, Supabase/PostgreSQL, Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-12-rankings-capitao-equipe-design.md`](../specs/2026-09-12-rankings-capitao-equipe-design.md)

**Branch:** `feat/amateur-admin-v2` · worktree `.worktrees/amateur-profiles`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260912120000_member_rankings.sql` | `national_rank`, `local_rank`, `is_captain`; remove `competition_rank` |
| `scripts/lib/amateur-csv.ts` | **Modificar** — quatro colunas novas, `s/d` → null |
| `scripts/__tests__/amateur-csv.test.ts` | **Modificar** — casos novos |
| `scripts/import-amateur-season.ts` | **Modificar** — grava o ID da SNP, resolve por ID primeiro |
| `scripts/__tests__/import-resolve.test.ts` | O teste do nome corrigido |
| `src/lib/amateur-profile.ts` | **Modificar** — tipos, selects, `buildRoster` |
| `src/app/[locale]/player/[id]/AmateurProfile.tsx` | **Modificar** — equipe sob o nome, chip zonal, insígnia, faixa removida |
| `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` | **Modificar** — widget do ranking nacional |
| `src/app/[locale]/snp/[slug]/TeamRoster.tsx` | **Modificar** — insígnia no plantel |
| `src/messages/{en,es,pt,it,fr}.json` | **Modificar** — três chaves |
| `import/blue-padel-25-26/players.csv` | **Modificar** — os dados (fora do git) |

---

## Task 1: Schema

**Files:**
- Create: `supabase/migrations/20260912120000_member_rankings.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- 20260912120000_member_rankings.sql
-- SNP publishes two rankings per player per season: national (Spain) and
-- zonal (Catalunya/Barcelona). Both live on team_memberships, which is
-- already the per-player, per-season row.
--
-- competition_rank is dropped. It is NULL in all 24 rows — verified before
-- writing this — and its name says nothing once two named rankings exist.

alter table public.team_memberships
  add column if not exists national_rank int,
  add column if not exists local_rank    int,
  add column if not exists is_captain    boolean not null default false;

alter table public.team_memberships
  drop column if exists competition_rank;

comment on column public.team_memberships.national_rank is
  'SNP national position for the season. NULL when the source says s/d.';
comment on column public.team_memberships.local_rank is
  'SNP zonal position (Catalunya/Barcelona). The one the profile leads with.';
comment on column public.team_memberships.is_captain is
  'Season captain. One per team today; becomes a role column if SNP ever
   distinguishes captain from delegate.';
```

- [ ] **Step 2: Aplicar**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260912120000_member_rankings.sql`
Expected: `Applied.`

- [ ] **Step 3: Verificar**

```bash
node -e "
const {Pool}=require('pg');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const u=new URL(process.env.DATABASE_URL);
const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
p.query(\"select column_name from information_schema.columns where table_schema='public' and table_name='team_memberships' and column_name in ('national_rank','local_rank','is_captain','competition_rank') order by 1\").then(r=>{console.log(r.rows.map(x=>x.column_name));return p.end()});
"
```

Expected: `[ 'is_captain', 'local_rank', 'national_rank' ]` — sem `competition_rank`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260912120000_member_rankings.sql
git commit -m "feat(amateur): national and local rankings, captain flag"
```

---

## Task 2: Parser do CSV

**Files:**
- Modify: `scripts/lib/amateur-csv.ts`
- Modify: `scripts/__tests__/amateur-csv.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao final de `scripts/__tests__/amateur-csv.test.ts`:

```ts
describe('parsePlayersCsv — rankings, captain and SNP id', () => {
  const HEADER =
    'name,side,home_club,competition_points,roster_rank,games_played,wins,losses,' +
    'snp_id,national_rank,local_rank,is_captain'

  it('reads the new columns', () => {
    const rows = parsePlayersCsv(
      `${HEADER}\nEric Ortega,,,43437.50,2,7,4,3,309288,4028,486,true\n`,
    )
    expect(rows[0].snpId).toBe('309288')
    expect(rows[0].nationalRank).toBe(4028)
    expect(rows[0].localRank).toBe(486)
    expect(rows[0].isCaptain).toBe(true)
  })

  it('turns s/d into null, never zero', () => {
    // A zero in a ranking claims first place — the opposite of "no data".
    // Three players in the real sheet carry s/d, and they are exactly the
    // three who never played.
    const rows = parsePlayersCsv(
      `${HEADER}\nWenjie Zhou,,,s/d,,0,0,0,372485,s/d,s/d,\n`,
    )
    expect(rows[0].competitionPoints).toBeNull()
    expect(rows[0].nationalRank).toBeNull()
    expect(rows[0].localRank).toBeNull()
  })

  it('defaults an empty captain cell to false, not null', () => {
    const rows = parsePlayersCsv(`${HEADER}\nJuan Rivas,,,23906.25,17,4,1,3,309292,7014,860,\n`)
    expect(rows[0].isCaptain).toBe(false)
  })

  it('tolerates a row with no snp_id', () => {
    const rows = parsePlayersCsv(`${HEADER}\nAlguien,,,,,0,0,0,,,,\n`)
    expect(rows[0].snpId).toBeNull()
    expect(rows[0].nationalRank).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run scripts/__tests__/amateur-csv.test.ts`
Expected: FAIL — `snpId` não existe no tipo.

- [ ] **Step 3: Implementar**

Em `scripts/lib/amateur-csv.ts`, troque o helper `num` e amplie `AmateurPlayerRow`:

```ts
/**
 * The SNP sheet writes "s/d" (sin datos) where a value does not exist.
 * It must become null, never 0 — a zero in a ranking column claims first
 * place, which is the opposite of "we have no figure".
 */
function num(value: string): number | null {
  const v = value.trim()
  if (v === '' || v.toLowerCase() === 's/d') return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
```

```ts
export interface AmateurPlayerRow {
  name: string
  side: string | null
  homeClub: string | null
  competitionPoints: number | null
  rosterRank: number | null
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
  snpId: string | null
  nationalRank: number | null
  localRank: number | null
  isCaptain: boolean
}
```

E no corpo de `parsePlayersCsv`, acrescente ao objeto devolvido:

```ts
    snpId: r.snp_id?.trim() || null,
    nationalRank: num(r.national_rank ?? ''),
    localRank: num(r.local_rank ?? ''),
    isCaptain: (r.is_captain ?? '').trim().toLowerCase() === 'true',
```

Remova `competitionRank` do tipo e do corpo — a coluna correspondente sumiu do banco.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run scripts/__tests__/amateur-csv.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/amateur-csv.ts scripts/__tests__/amateur-csv.test.ts
git commit -m "feat(amateur): parse rankings, captain and SNP id from the sheet"
```

---

## Task 3: Resolução por ID no import

Esta é a task que justifica guardar o ID. Hoje o import casa por nome normalizado: corrigir `Diaz` para `Díaz` na planilha **cria um jogador novo** e deixa o antigo órfão com todo o histórico.

**Files:**
- Modify: `scripts/import-amateur-season.ts`
- Test: `scripts/__tests__/import-resolve.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

A resolução vira uma função pura testável; o script passa a usá-la.

```ts
// scripts/__tests__/import-resolve.test.ts
// The import matched players by normalised name. That is fragile in one
// specific way: fixing an accent in the spreadsheet creates a second player
// and orphans the first one's history. The SNP id closes that.
import { describe, it, expect } from 'vitest'
import { resolvePlayerId, type ResolutionIndex } from '../lib/amateur-resolve'

const INDEX: ResolutionIndex = {
  bySnpId: new Map([['319382', 'uuid-david']]),
  byNormalizedName: new Map([['david diaz dangla', 'uuid-david']]),
}

describe('resolvePlayerId', () => {
  it('matches by SNP id', () => {
    expect(resolvePlayerId(INDEX, '319382', 'David Diaz Dangla')).toBe('uuid-david')
  })

  it('matches the SAME player when the name gains an accent', () => {
    // The whole point. Without the id this returns null and the caller
    // creates a duplicate.
    expect(resolvePlayerId(INDEX, '319382', 'David Díaz Dangla')).toBe('uuid-david')
  })

  it('falls back to the normalised name when there is no id', () => {
    expect(resolvePlayerId(INDEX, null, 'DAVID DIAZ DANGLA')).toBe('uuid-david')
  })

  it('returns null for someone genuinely new', () => {
    expect(resolvePlayerId(INDEX, '999999', 'Alguien Nuevo')).toBeNull()
  })

  it('prefers the id over a name that points elsewhere', () => {
    // A renamed player whose new name collides with another row must follow
    // the id, not the collision.
    const idx: ResolutionIndex = {
      bySnpId: new Map([['319382', 'uuid-david']]),
      byNormalizedName: new Map([['david diaz dangla', 'uuid-other']]),
    }
    expect(resolvePlayerId(idx, '319382', 'David Diaz Dangla')).toBe('uuid-david')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run scripts/__tests__/import-resolve.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/amateur-resolve"`

- [ ] **Step 3: Implementar a função pura**

```ts
// scripts/lib/amateur-resolve.ts
// Player resolution for the season import.
//
// The id wins over the name, always. A spreadsheet name is edited by hand and
// drifts — accents get fixed, case changes, a surname is added. The SNP id
// does not. Resolving by name first would mean a corrected accent silently
// creates a second player and orphans the original's history.

export interface ResolutionIndex {
  bySnpId: Map<string, string>
  byNormalizedName: Map<string, string>
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolvePlayerId(
  index: ResolutionIndex,
  snpId: string | null,
  name: string,
): string | null {
  if (snpId) {
    const byId = index.bySnpId.get(snpId)
    if (byId) return byId
  }
  return index.byNormalizedName.get(normalizeName(name)) ?? null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run scripts/__tests__/import-resolve.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Usar no script**

Em `scripts/import-amateur-season.ts`:

Importe `resolvePlayerId`, `normalizeName` e `type ResolutionIndex` de `./lib/amateur-resolve`, e remova a função `normalize` local (a de `amateur-resolve` é a mesma).

Antes do loop de resolução, monte o índice — o mapa por ID vem de `entity_external_ids`:

```ts
  const { data: snpIds } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'player')
    .eq('source', 'snp')

  const index: ResolutionIndex = {
    bySnpId: new Map((snpIds ?? []).map(r => [r.external_id, r.entity_id])),
    byNormalizedName: new Map(
      (existing ?? [])
        .filter(r => r.normalized_name)
        .map(r => [r.normalized_name as string, r.id]),
    ),
  }
```

Troque o casamento por nome por `resolvePlayerId(index, p.snpId, p.name)`.

Depois de criar ou resolver cada jogador, registre o ID quando houver:

```ts
    if (p.snpId) {
      await registerSourceId(supabase, {
        entityType: 'player',
        entityId: playerId,
        source: 'snp',
        externalId: p.snpId,
      })
    }
```

Import: `import { registerSourceId } from '../src/lib/external-id-registry'`.

E no upsert de `team_memberships`, troque `competition_rank` pelos campos novos:

```ts
        national_rank: p.nationalRank,
        local_rank: p.localRank,
        is_captain: p.isCaptain,
```

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5`
Expected: sem saída.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/amateur-resolve.ts scripts/__tests__/import-resolve.test.ts scripts/import-amateur-season.ts
git commit -m "feat(amateur): resolve players by SNP id before falling back to the name"
```

---

## Task 4: Levar os campos até a UI

**Files:**
- Modify: `src/lib/amateur-profile.ts`
- Modify: `src/lib/__tests__/amateur-profile.test.ts`
- Modify: `src/lib/__tests__/team-season.test.ts`

- [ ] **Step 1: Trocar os tipos**

Em `AmateurRawRows`, no bloco `membership`, troque `competition_rank: number | null` por:

```ts
    national_rank: number | null
    local_rank: number | null
    is_captain: boolean
```

No bloco `roster`, acrescente `is_captain: boolean` ao item.

Em `AmateurRosterEntry`, acrescente:

```ts
  isCaptain: boolean
```

Em `AmateurProfileData`, troque `competitionRank: number | null` por:

```ts
  nationalRank: number | null
  localRank: number | null
  isCaptain: boolean
```

- [ ] **Step 2: Atualizar os selects e os builders**

Nos **dois** selects de `team_memberships` (o de `fetchAmateurProfile` e o de `fetchTeamSeason`), troque `competition_rank` por `national_rank, local_rank, is_captain`.

Em `buildRoster`, acrescente ao objeto mapeado:

```ts
      isCaptain: r.is_captain ?? false,
```

Em `buildAmateurProfile`, troque `competitionRank: raw.membership.competition_rank` por:

```ts
    nationalRank: raw.membership.national_rank,
    localRank: raw.membership.local_rank,
    isCaptain: raw.membership.is_captain ?? false,
```

Localize tudo com:

Run: `grep -rn "competition_rank\|competitionRank" src/ scripts/`

- [ ] **Step 3: Atualizar os fixtures dos testes**

Nos dois arquivos de teste, o `membership` do fixture troca `competition_rank: 412` por `national_rank: 4397, local_rank: 528, is_captain: false`, e cada item de `roster` ganha `is_captain: false`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5 && npx vitest run src/lib/__tests__/amateur-profile.test.ts src/lib/__tests__/team-season.test.ts 2>&1 | grep -E "Tests|Test Files"`
Expected: sem erros de tipo; 13 testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-profile.ts src/lib/__tests__/
git commit -m "feat(amateur): carry rankings and captain through the profile data"
```

---

## Task 5: i18n

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Três chaves no namespace `amateur`**

- `localRank` — en `"Zonal rank"` · es `"Ranking zonal"` · pt `"Ranking zonal"` · it `"Classifica zonale"` · fr `"Classement zonal"`
- `nationalRank` — en `"National rank"` · es `"Ranking nacional"` · pt `"Ranking nacional"` · it `"Classifica nazionale"` · fr `"Classement national"`
- `captain` — en `"Captain"` · es `"Capitán"` · pt `"Capitão"` · it `"Capitano"` · fr `"Capitaine"`

A chave `competitionRank` fica sem uso — **remova-a dos cinco arquivos** no mesmo passo, senão vira exatamente o tipo de resíduo que já nos custou tempo com o `_tbd_context`.

- [ ] **Step 2: Verificar paridade**

```bash
node -e "
const l=['en','es','pt','it','fr'].map(x=>[x,require('./src/messages/'+x+'.json').amateur]);
const base=Object.keys(l[0][1]).sort();
for(const [n,o] of l){const k=Object.keys(o).sort();
 if(JSON.stringify(k)!==JSON.stringify(base)){console.error(n,'mismatch');process.exit(1)}
 for(const need of ['localRank','nationalRank','captain']) if(!o[need]){console.error(n,'falta',need);process.exit(1)}
 if(o.competitionRank){console.error(n,'ainda tem competitionRank');process.exit(1)}}
console.log('os cinco locales, com', base.length, 'chaves, sem competitionRank');
"
```

Expected: a linha de confirmação.

- [ ] **Step 3: Commit**

```bash
git add src/messages/
git commit -m "feat(amateur): ranking and captain strings"
```

---

## Task 6: O hero

**Files:**
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`

- [ ] **Step 1: Equipe sob o nome**

Troque a linha que hoje mostra `[player.home_club, data?.team.city]`:

```tsx
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: MUTED, fontSize: 12 }}>
              {player.country && <FlagImage country={player.country} size={16} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data?.team.name ?? ''}
              </span>
            </div>
```

`home_club` sai da tela aqui. A coluna permanece no banco sem leitor — registrado na spec como dívida, não como esquecimento.

- [ ] **Step 2: Insígnia de capitão ao lado do nome**

Logo depois do `<div>` do nome:

```tsx
              {data?.isCaptain && (
                <span style={{
                  display: 'inline-block', marginLeft: 8, verticalAlign: 'middle',
                  border: `1px solid ${ORANGE}`, color: ORANGE,
                  fontSize: 8, fontWeight: 800, padding: '2px 6px',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {t('captain')}
                </span>
              )}
```

Para que ele fique na mesma linha do nome, envolva nome e insígnia:

```tsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0 }}>
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </span>
                {/* insígnia aqui */}
              </div>
```

- [ ] **Step 3: Chip do ranking zonal**

Troque o bloco que hoje monta o chip a partir de `data.competitionRank`:

```tsx
    // The zonal ranking leads: it measures the player against people they can
    // actually meet on a court. The national number is in the thousands and
    // says little about the next match — it lives in the Summary tab.
    chips.push({
      label: t('localRank'),
      value: data.localRank != null ? `#${data.localRank}` : '—',
      accent: 'orange',
    })
```

Note que o chip aparece **sempre**, com traço quando não há dado — diferente do anterior, que sumia. Quatro chips estáveis evitam o hero mudando de forma entre jogadores.

- [ ] **Step 4: Remover a faixa da equipe**

Apague o `<button>` da faixa laranja que mostra `data.team.name` e leva à aba Equipe. A informação passou para a linha sob o nome; a navegação continua pela aba.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npx eslint "src/app/[locale]/player/[id]/AmateurProfile.tsx" 2>&1 | tail -3`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/player/[id]/AmateurProfile.tsx"
git commit -m "feat(amateur): team under the name, zonal rank chip, captain badge"
```

---

## Task 7: Ranking nacional e insígnia no plantel

**Files:**
- Modify: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`
- Modify: `src/app/[locale]/snp/[slug]/TeamRoster.tsx`

- [ ] **Step 1: Widget do ranking nacional**

Em `SummaryTab.tsx`, logo depois do widget de pontos:

```tsx
      {data.nationalRank != null && (
        <Widget label={t('nationalRank')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            #{data.nationalRank}
          </div>
        </Widget>
      )}
```

Aqui, ao contrário do chip do hero, o widget **some** quando não há dado: a grade do Resumo já é variável por natureza, e um card com traço só ocuparia espaço.

- [ ] **Step 2: Insígnia no plantel**

Em `TeamRoster.tsx`, dentro da linha, logo depois do `<span>` do nome:

```tsx
            {r.isCaptain && (
              <span style={{
                flexShrink: 0, border: `1px solid ${ORANGE}`, color: ORANGE,
                fontSize: 8, fontWeight: 800, padding: '1px 5px',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {t('captain')}
              </span>
            )}
```

Acrescente `const ORANGE = '#F5A623'` às constantes do arquivo e troque o namespace do `useTranslations` de `'team'` para conseguir a chave: o rótulo `captain` está em `amateur`. Use um segundo hook — `const tAmateur = useTranslations('amateur')` — em vez de duplicar a string no namespace `team`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npm run build 2>&1 | tail -2`
Expected: sem erros; build conclui.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx" "src/app/[locale]/snp/[slug]/TeamRoster.tsx"
git commit -m "feat(amateur): national rank widget and captain badge in the squad"
```

---

## Task 8: Carregar os dados

**Files:**
- Modify: `import/blue-padel-25-26/players.csv` (fora do git)

- [ ] **Step 1: Acrescentar as colunas ao CSV**

O cabeçalho passa a ser:

```
name,side,home_club,competition_points,roster_rank,games_played,wins,losses,snp_id,national_rank,local_rank,is_captain
```

Os valores vêm da planilha do operador. `s/d` pode ser escrito literalmente — o parser o converte em nulo. O `is_captain` é `true` apenas no Eric Ortega e vazio nos demais.

**Atenção ao separador de milhar.** A planilha escreve os pontos como `43,437.50`. O parser deste projeto é um split por vírgula, sem aspas — colar esse valor no CSV **parte a linha em duas células** e desloca todas as colunas seguintes, o que faz o ranking nacional cair na coluna do zonal sem nenhum erro visível. Escreva `43437.50`. O `num()` também remove vírgulas como defesa, mas isso não recupera um valor que já foi partido em dois.

Os rankings são inteiros sem separador (`2615`, `296`) e não correm esse risco.

Referência dos 24, na ordem da planilha (`snp_id | national_rank | local_rank`):

```
254659|2615|296    ALBERT URBANO TORRENT
309288|4028|486    ERIC ORTEGA          ← capitão
331993|4141|501    GERARD LORENTE SÁNCHEZ
319382|4171|505    DAVID DIAZ DANGLA
377684|4397|528    Gustavo Denes
394822|4487|538    Adrián Rivas Fernández
373440|4591|547    William Yang
371976|4661|554    Eduard Ferrer Casals
342058|4762|568    SERGIO MANCERA ROS
391042|5131|612    Hugo Pomares Ruiz
394402|5250|633    Arnau Argilaga Arcos
314196|5422|653    POL CANTERIA LOPEZ
342967|5895|713    JONATAN FERNÁNDEZ SÁNCHEZ
376840|6307|767    Jaume Zabalia Famadas
317060|6762|821    PABLO CABALLERO CORBALAN
327203|6950|853    VALENTIN Bretagne
309292|7014|860    JUAN RIVAS
274477|8560|1080   ANDREU SEGUNDO RIGAT
348264|9284|1196   OSCAR MARTINEZ GOMEZ
353730|9633|1242   GABRIEL GARCIA OLIVETO
306355|9677|1247   ALEJANDRO TORNER TRINXET
293158|s/d|s/d     MARIO ESTRADA BARRERAS
372485|s/d|s/d     Wenjie Zhou
372491|s/d|s/d     Abraham Torres Jurado
```

- [ ] **Step 2: Dry run**

```bash
npx tsx scripts/import-amateur-season.ts --dir ./import/blue-padel-25-26 \
  --team-slug blue-padel-mataro --team-name "Blue Padel Mataró" \
  --season 25/26 --source snp --external-id blue-padel-mataro-2526 \
  --competition "Series Nacionales de Pádel · Barcelona · Masculino 1000"
```

Expected: **`24 — 24 matched, 0 to create`**.

Qualquer número diferente de zero em "to create" significa que a resolução falhou e o import duplicaria jogadores. Pare e investigue antes de aplicar.

- [ ] **Step 3: Aplicar**

O mesmo comando com `--apply`.
Expected: `Done.`

- [ ] **Step 4: Conferir no banco**

```bash
node -e "
const {Pool}=require('pg');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const u=new URL(process.env.DATABASE_URL);
const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
(async()=>{
  const a=await p.query(\"select count(*)::int total, count(national_rank)::int com_nac, count(local_rank)::int com_loc, count(*) filter (where is_captain)::int capitaes from team_memberships\");
  console.log(a.rows[0]);
  const b=await p.query(\"select pl.name from team_memberships tm join players pl on pl.id=tm.player_id where tm.is_captain\");
  console.log('capitão:', b.rows.map(x=>x.name));
  const c=await p.query(\"select count(*)::int from entity_external_ids where source='snp' and entity_type='player'\");
  console.log('ids snp guardados:', c.rows[0].count);
  await p.end();
})();
"
```

Expected: `total: 24, com_nac: 21, com_loc: 21, capitaes: 1`; capitão `Eric Ortega`; 24 IDs guardados.

Os 21 são os 24 menos os três com `s/d`. **Se vier 24, o `s/d` virou zero** — é a falha que o teste da Task 2 existe para impedir, e ela teria colocado três jogadores em primeiro lugar.

- [ ] **Step 5: Provar que o ID protege**

Rode o import de novo com o nome do David corrigido para `David Díaz Dangla` no CSV, em dry run:

Expected: ainda **`24 matched, 0 to create`**. Se aparecer `1 to create`, a resolução por ID não está funcionando.

Desfaça a alteração do nome no CSV depois.

---

## Task 9: Verificação final

**Files:** nenhum — verificação.

- [ ] **Step 1: Build e start**

```bash
npm run build && npx next start -p 3007
```

- [ ] **Step 2: O perfil do capitão**

Abra `/es/player/c4787953-d54e-4b11-af50-da897164663a` (Eric Ortega) em viewport mobile. Confirme: a insígnia **CAPITÁN** ao lado do nome; a equipe `Blue Padel Mataró` na linha abaixo, com a bandeira; o chip **Ranking zonal `#486`**; e nenhuma faixa laranja de equipe.

Na aba Resumo, o widget **Ranking nacional `#4028`**.

- [ ] **Step 3: Um sem ranking**

Abra o perfil do Wenjie Zhou. O chip de ranking zonal deve mostrar **traço**, não `#0`. Um `#0` ali significa que o `s/d` virou zero em algum ponto do caminho.

Encontre o id com:

```bash
node -e "
const {Pool}=require('pg');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const u=new URL(process.env.DATABASE_URL);
const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
p.query(\"select id,name from players where name ilike '%Wenjie%'\").then(r=>{console.log(r.rows);return p.end()});
"
```

- [ ] **Step 4: O plantel**

Em `/es/snp/blue-padel-mataro`, aba Plantilla: a insígnia de capitão aparece só no Eric Ortega.

- [ ] **Step 5: Console e rede**

`read_console_messages` e `read_network_requests`: sem erros, sem 4xx/5xx.

- [ ] **Step 6: Suíte**

Run: `npx vitest run src/lib/__tests__/ scripts/__tests__/ 2>&1 | grep -E "Tests|Test Files"`
Expected: verde.

- [ ] **Step 7: Screenshot**

Do perfil do Eric com a insígnia e o ranking zonal, para o operador.
