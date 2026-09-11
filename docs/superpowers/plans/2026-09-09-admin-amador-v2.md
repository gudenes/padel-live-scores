# Admin de amadores v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador suba a foto de um jogador amador pelo admin, encurtar o rótulo da competição para o selo parar de quebrar linha, e fazer o perfil suportar mais de uma temporada com um seletor.

**Architecture:** Três partes independentes sobre o perfil amador já em produção. Duas colunas novas em `teams` carregam os rótulos curtos. O upload copia o padrão já existente de `upload-equipment-image`, restrito a `tier='amateur'`. O suporte a temporadas separa "listar temporadas" de "carregar uma temporada" no lado de I/O, sem tocar na função pura que monta os dados.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (Postgres + Storage), Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-09-admin-amador-v2-design.md`](../specs/2026-09-09-admin-amador-v2-design.md)

**Branch:** `feat/amateur-admin-v2` · worktree `.worktrees/amateur-profiles`

---

## Pré-requisito antes de começar

`apps/ops` é um pacote npm independente e **suas dependências não estão instaladas neste worktree** — é por isso que os testes de `apps/ops/**` falham na suíte raiz. As Tasks 3 e 4 mexem em `apps/ops`, então instale antes:

```bash
cd apps/ops && npm install && cd ../..
```

Se a instalação falhar ou demorar demais, pare e reporte — não vale prosseguir escrevendo testes que você não consegue rodar.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260909180000_team_labels.sql` | `teams.badge_label` + `teams.short_name` + o UPDATE do Blue Padel |
| `src/lib/amateur-profile.ts` | **Modificar** — `fetchAmateurSeasons` + `seasonId` opcional no fetch; tipos do team ganham os rótulos |
| `src/app/[locale]/player/[id]/AmateurProfile.tsx` | **Modificar** — selo literal, seletor de temporada, `?season=` na URL |
| `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` | **Modificar** — label do widget de pontos usa `short_name` |
| `apps/ops/src/app/api/internal/upload-player-avatar/route.ts` | Upload multipart → bucket `avatars`, só amador |
| `apps/ops/src/app/api/internal/upload-player-avatar/__tests__/route.test.ts` | Testes da rota |
| `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx` | **Modificar** — controle de troca de foto em amador |

---

## Task 1: Colunas de rótulo em `teams`

**Files:**
- Create: `supabase/migrations/20260909180000_team_labels.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- 20260909180000_team_labels.sql
-- Short labels for a team's competition.
--
-- `teams.competition` holds the full name ("Series Nacionales de Pádel ·
-- Barcelona · Masculino 1000"), which overflows the hero badge and the points
-- widget. These two columns carry the compact forms. Both nullable: without
-- them the UI falls back to the derived short form, so teams imported without
-- labels keep working.

alter table public.teams
  add column if not exists badge_label text,
  add column if not exists short_name  text;

comment on column public.teams.badge_label is
  'Verbatim hero badge text, same in every locale (e.g. "Amador · SNP"). Null = compose from i18n + competition.';
comment on column public.teams.short_name is
  'Compact competition reference for labels (e.g. "SNP"). Null = fall back to competition.';

update public.teams
   set badge_label = 'Amador · SNP',
       short_name  = 'SNP'
 where slug = 'blue-padel-mataro';
```

- [ ] **Step 2: Aplicar**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260909180000_team_labels.sql`
Expected: `Applied.`

- [ ] **Step 3: Verificar**

```bash
node -e "
const {Pool}=require('pg');const fs=require('fs');
const t=fs.readFileSync('.env.local','utf8');
for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const u=new URL(process.env.DATABASE_URL);
const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
p.query('select slug, badge_label, short_name from public.teams').then(r=>{console.table(r.rows);return p.end()});
"
```

Expected: uma linha, `blue-padel-mataro` com `Amador · SNP` e `SNP`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909180000_team_labels.sql
git commit -m "feat(amateur): short competition labels on teams"
```

---

## Task 2: Usar os rótulos curtos na UI pública

**Files:**
- Modify: `src/lib/amateur-profile.ts` (tipo do team + o select)
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`
- Modify: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`

- [ ] **Step 1: Levar as colunas novas até o tipo e a query**

Em `src/lib/amateur-profile.ts`, no bloco `team` de `AmateurRawRows`, acrescente após `category`:

```ts
    badge_label: string | null
    short_name: string | null
```

E no `select` de `fetchAmateurProfile` para a tabela `teams`, troque a lista de colunas por:

```ts
    .select('id, slug, name, club, city, country, crest_url, competition, category, badge_label, short_name')
```

- [ ] **Step 2: Selo literal no hero**

Em `AmateurProfile.tsx`, o selo está na linha ~161. Substitua a expressão dentro do `<span>`:

```tsx
                {data?.team.badge_label
                  ?? (competitionShort ? `${t('badge')} · ${competitionShort}` : t('badge'))}
```

E logo abaixo de `competitionShort` (linha ~75), acrescente a referência compacta que o resto do arquivo passa a usar:

```tsx
  // Prefer the operator-set short name; fall back to the first segment of the
  // full competition string, which is what v1 derived.
  const competitionLabel = data?.team.short_name ?? competitionShort
```

Depois troque os dois usos restantes de `competitionShort` por `competitionLabel`: o chip de ranking (~linha 88) e o `teamRank` da faixa da equipe (~linha 209).

- [ ] **Step 3: Label do widget de pontos**

Em `SummaryTab.tsx`, o widget de pontos monta o label com `data.team.competition?.split('·')[0].trim()`. Troque por:

```tsx
        <Widget label={t('competitionPoints', {
          competition: data.team.short_name ?? data.team.competition?.split('·')[0].trim() ?? '',
        })}>
```

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5`
Expected: nenhuma linha (os erros de `push-copy.test.ts` são pré-existentes e não relacionados).

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-profile.ts "src/app/[locale]/player/[id]/AmateurProfile.tsx" "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"
git commit -m "feat(amateur): render the short competition labels"
```

---

## Task 3: Rota de upload de avatar

**Files:**
- Create: `apps/ops/src/app/api/internal/upload-player-avatar/route.ts`
- Test: `apps/ops/src/app/api/internal/upload-player-avatar/__tests__/route.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/ops/src/app/api/internal/upload-player-avatar/__tests__/route.test.ts
// Operator avatar upload, restricted to amateur players.
//
// Auth.js and the Supabase service client are mocked. The Supabase mock
// exposes both the `players` tier lookup and the storage upload, so each
// test can drive one of them.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, tierResult, uploadResult } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  tierResult: { value: { data: { tier: 'amateur' }, error: null } as unknown },
  uploadResult: { value: { error: null } as unknown },
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

const PLAYER_ID = '77ab6a3d-7484-46d2-b873-f90df0a4a1a0'

function formWith(file: File | null, playerId: string = PLAYER_ID): Request {
  const form = new FormData()
  if (file) form.set('file', file)
  form.set('playerId', playerId)
  return new Request('http://localhost/api/internal/upload-player-avatar', {
    method: 'POST',
    body: form,
  })
}

function pngOf(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' })
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  tierResult.value = { data: { tier: 'amateur' }, error: null }
  uploadResult.value = { error: null }
  serviceClientMock.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(tierResult.value) }) }),
    }),
    storage: {
      from: () => ({ upload: () => Promise.resolve(uploadResult.value) }),
    },
  })
})

describe('POST /api/internal/upload-player-avatar', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(401)
  })

  it('rejects a professional player', async () => {
    tierResult.value = { data: { tier: 'pro' }, error: null }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/amateur/i)
  })

  it('rejects a player that does not exist', async () => {
    tierResult.value = { data: null, error: null }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(404)
  })

  it('rejects an unsupported file type', async () => {
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    const res = await POST(formWith(gif))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/type/i)
  })

  it('rejects a file over 2 MB', async () => {
    const res = await POST(formWith(pngOf(2 * 1024 * 1024 + 1)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/large/i)
  })

  it('rejects a playerId that is not a uuid', async () => {
    const res = await POST(formWith(pngOf(10), 'not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('returns a cache-busted public url on success', async () => {
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    // The storage key is stable per player, so without ?v= the CDN would keep
    // serving the previous photo.
    expect(url).toContain(`/avatars/${PLAYER_ID}.png`)
    expect(url).toMatch(/\?v=\d+$/)
  })

  it('surfaces a storage failure as a 500', async () => {
    uploadResult.value = { error: { message: 'boom' } }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd apps/ops && npx vitest run src/app/api/internal/upload-player-avatar --root . ; cd ../..`
Expected: FAIL — não resolve `../route`.

Se o comando não encontrar a config do Vitest, rode da raiz: `npx vitest run apps/ops/src/app/api/internal/upload-player-avatar`.

- [ ] **Step 3: Implementar a rota**

```ts
// apps/ops/src/app/api/internal/upload-player-avatar/route.ts
// Multipart upload of an amateur player's photo.
// Stores it in the `avatars` Supabase Storage bucket as {playerId}.{ext} and
// returns the public URL. Does NOT write the DB row — the caller persists it
// with the existing PATCH /api/internal/player/[id], which already allow-lists
// avatar_url. Same split as upload-equipment-image.
//
// Amateurs only: source-priority gives players.avatar_url to padelapi, so a
// manual photo on a professional would be overwritten the next time the sync
// runs (currently paused behind PADELAPI_PAUSED). A photo that silently
// disappears is worse than a button that isn't there.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024
const BUCKET = 'avatars'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const playerId = String(form.get('playerId') ?? '')
  const file = form.get('file')

  if (!isUuid(playerId)) {
    return Response.json({ error: 'playerId must be a uuid' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type}`, allowed: Array.from(ALLOWED_MIME) },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 400 })
  }

  const supabase = serviceClient()

  const { data: player } = await supabase
    .from('players')
    .select('tier')
    .eq('id', playerId)
    .single()

  if (!player) {
    return Response.json({ error: 'player not found' }, { status: 404 })
  }
  if (player.tier !== 'amateur') {
    return Response.json(
      { error: 'Photo upload is available for amateur players only' },
      { status: 400 },
    )
  }

  const ext = pickExtension(file.type)
  const filePath = `${playerId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  // ?v= is load-bearing: the key is stable per player, so a replacement photo
  // would otherwise be masked by the CDN and by next/image's cache.
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}` +
    `?v=${Date.now()}`

  return Response.json({ url })
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run apps/ops/src/app/api/internal/upload-player-avatar`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/internal/upload-player-avatar/
git commit -m "feat(ops): avatar upload route for amateur players"
```

---

## Task 4: Controle de troca de foto no admin

**Files:**
- Modify: `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx`

- [ ] **Step 1: Adicionar `tier` ao tipo e o estado de upload**

No topo do arquivo, troque o import do React por:

```tsx
'use client'
import { useRef, useState } from 'react'
```

(Se o arquivo já não for `'use client'`, acrescente a diretiva na primeira linha — o controle usa estado.)

Em `ProfileHeaderPlayer`, acrescente:

```tsx
  tier: string | null
```

Dentro do componente, antes do `return`:

```tsx
  const [avatarUrl, setAvatarUrl] = useState(player.avatar_url)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isAmateur = player.tier === 'amateur'

  async function handleFile(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('playerId', player.id)
      const up = await fetch('/api/internal/upload-player-avatar', { method: 'POST', body: form })
      const upBody = await up.json()
      if (!up.ok) throw new Error(upBody.error ?? 'upload failed')

      const patch = await fetch(`/api/internal/player/${player.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: upBody.url }),
      })
      if (!patch.ok) throw new Error((await patch.json()).error ?? 'save failed')

      setAvatarUrl(upBody.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }
```

`ProfileHeaderPlayer` precisa carregar `id`. Confirme com `grep -n "id" apps/ops/src/app/\(app\)/players/\[id\]/_components/ProfileHeader.tsx`; se não houver, acrescente `id: string` ao tipo e passe-o de `PlayerProfile.tsx`.

- [ ] **Step 2: Trocar o bloco do avatar pelo controle**

Substitua o bloco `{player.avatar_url ? (<img .../>) : (<div>{initials(...)}</div>)}` inteiro por:

```tsx
      <div className="relative">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={player.name}
            className="w-24 h-24 rounded-full object-cover border"
            style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-card)' }}
          />
        ) : (
          <div
            className="w-24 h-24 rounded-full border flex items-center justify-center text-2xl font-bold"
            style={{
              background: 'var(--bg-hover)',
              borderColor: 'var(--border-card)',
              color: 'var(--text-3)',
            }}
          >
            {initials(displayName)}
          </div>
        )}
        {isAmateur && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-2 w-24 px-2 py-1 text-xs border rounded cursor-pointer"
              style={{
                borderColor: 'var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-1)',
              }}
            >
              {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Add photo'}
            </button>
            {uploadError && (
              <div className="mt-1 w-24 text-xs" style={{ color: 'var(--text-danger, #e24b4a)' }}>
                {uploadError}
              </div>
            )}
          </>
        )}
      </div>
```

O `e.target.value = ''` depois de escolher o arquivo é o que permite subir **o mesmo arquivo duas vezes seguidas** — sem isso o `change` não dispara na segunda vez.

- [ ] **Step 3: Passar `tier` do aggregator até o componente**

Confirme que o GET de `apps/ops/src/app/api/internal/player/[id]/route.ts` inclui `tier` no select do jogador:

Run: `grep -n "select(" apps/ops/src/app/api/internal/player/\[id\]/route.ts | head -3`

Se `tier` não estiver na lista, acrescente. Depois confirme que `PlayerProfile.tsx` repassa o objeto inteiro para `ProfileHeader` (ele já faz: `<ProfileHeader player={state.data.player} />`).

- [ ] **Step 4: Verificar tipos**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | head -5 ; cd ../..`
Expected: nenhum erro nos arquivos tocados.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx" "apps/ops/src/app/api/internal/player/[id]/route.ts"
git commit -m "feat(ops): photo upload control on the amateur player profile"
```

---

## Task 5: Fetch de múltiplas temporadas

**Files:**
- Modify: `src/lib/amateur-profile.ts`
- Test: `src/lib/__tests__/amateur-seasons.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

A ordenação é a única lógica nova que merece teste — ela existe porque `starts_on` é nullable e a 25/26 importada não o preencheu.

```ts
// src/lib/__tests__/amateur-seasons.test.ts
import { describe, it, expect } from 'vitest'
import { sortSeasonRefs, type AmateurSeasonRef } from '../amateur-profile'

const S = (label: string, startsOn: string | null): AmateurSeasonRef => ({
  seasonId: `id-${label}`,
  label,
  startsOn,
  teamId: 't-1',
  teamName: 'Blue Padel Mataró',
})

describe('sortSeasonRefs', () => {
  it('puts the most recent season first by start date', () => {
    const sorted = sortSeasonRefs([S('25/26', '2025-09-01'), S('26/27', '2026-09-01')])
    expect(sorted.map(s => s.label)).toEqual(['26/27', '25/26'])
  })

  it('falls back to the label when start dates are missing', () => {
    // The 25/26 import left starts_on null, so label ordering is what saves us.
    const sorted = sortSeasonRefs([S('25/26', null), S('26/27', null)])
    expect(sorted.map(s => s.label)).toEqual(['26/27', '25/26'])
  })

  it('ranks a dated season above an undated one', () => {
    const sorted = sortSeasonRefs([S('25/26', null), S('26/27', '2026-09-01')])
    expect(sorted[0].label).toBe('26/27')
  })

  it('returns an empty list untouched', () => {
    expect(sortSeasonRefs([])).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/amateur-seasons.test.ts`
Expected: FAIL — `sortSeasonRefs` não é exportado.

- [ ] **Step 3: Implementar**

Em `src/lib/amateur-profile.ts`, acrescente o tipo e a função pura junto dos outros exports:

```ts
export interface AmateurSeasonRef {
  seasonId: string
  label: string
  /** team_seasons.starts_on — null on the hand-imported 25/26. */
  startsOn: string | null
  teamId: string
  teamName: string
}

/**
 * Most recent first. Sorts by start date, then by label — the 25/26 import
 * left starts_on null, so label ordering is the real tiebreak in practice.
 * A dated season always outranks an undated one.
 */
export function sortSeasonRefs(refs: AmateurSeasonRef[]): AmateurSeasonRef[] {
  return [...refs].sort((a, b) => {
    if (a.startsOn && b.startsOn) return b.startsOn.localeCompare(a.startsOn)
    if (a.startsOn) return -1
    if (b.startsOn) return 1
    return b.label.localeCompare(a.label)
  })
}
```

E a função de I/O que a usa:

```ts
/** Every season this player has a membership in, most recent first. */
export async function fetchAmateurSeasons(playerId: string): Promise<AmateurSeasonRef[]> {
  const { data } = await supabase
    .from('team_memberships')
    .select('team_season_id, season:team_seasons(id, label, starts_on, team:teams(id, name))')
    .eq('player_id', playerId)

  type Row = {
    team_season_id: string
    season: {
      id: string
      label: string
      starts_on: string | null
      team: { id: string; name: string } | null
    } | null
  }

  const refs = ((data ?? []) as unknown as Row[])
    .filter(r => r.season != null)
    .map(r => ({
      seasonId: r.season!.id,
      label: r.season!.label,
      startsOn: r.season!.starts_on,
      teamId: r.season!.team?.id ?? '',
      teamName: r.season!.team?.name ?? '',
    }))

  return sortSeasonRefs(refs)
}
```

E mude a assinatura de `fetchAmateurProfile` para aceitar a temporada escolhida. A primeira query passa a ser:

```ts
export async function fetchAmateurProfile(
  playerId: string,
  seasonId?: string,
): Promise<AmateurProfileData | null> {
  let membershipQuery = supabase
    .from('team_memberships')
    .select('team_season_id, player_id, competition_points, competition_rank, roster_rank, games_played, wins, losses')
    .eq('player_id', playerId)

  if (seasonId) membershipQuery = membershipQuery.eq('team_season_id', seasonId)

  const { data: membership } = await membershipQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!membership) return null
```

O resto do corpo fica exatamente como está. `buildAmateurProfile` **não muda** — os 8 testes dela seguem valendo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/amateur-seasons.test.ts src/lib/__tests__/amateur-profile.test.ts`
Expected: PASS — 4 + 8 = 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/amateur-profile.ts src/lib/__tests__/amateur-seasons.test.ts
git commit -m "feat(amateur): list a player's seasons and load a chosen one"
```

---

## Task 6: Seletor de temporada no perfil

**Files:**
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Acrescentar a chave i18n nos cinco locales**

No bloco `amateur` de cada arquivo, acrescente uma chave. Valores: en `"Season"`, es `"Temporada"`, pt `"Temporada"`, it `"Stagione"`, fr `"Saison"`.

```json
    "seasonSelector": "Season",
```

- [ ] **Step 2: Carregar as temporadas e reagir à escolha**

Em `AmateurProfile.tsx`, troque o bloco de imports vindos de `@/lib/amateur-profile` por:

```tsx
import {
  fetchAmateurProfile,
  fetchAmateurSeasons,
  type AmateurProfileData,
  type AmateurSeasonRef,
} from '@/lib/amateur-profile'
```

E acrescente `useSearchParams` ao import de `next/navigation`:

```tsx
import { useSearchParams } from 'next/navigation'
```

Dentro do componente, substitua o `useEffect` de carga por:

```tsx
  const searchParams = useSearchParams()
  const [seasons, setSeasons] = useState<AmateurSeasonRef[]>([])
  // The label carries a slash ("25/26"), so it must be decoded on read and
  // encoded on write — otherwise the param arrives truncated.
  const seasonParam = (() => {
    const raw = searchParams.get('season')
    return raw ? decodeURIComponent(raw) : null
  })()
  const [selectedLabel, setSelectedLabel] = useState<string | null>(seasonParam)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const list = await fetchAmateurSeasons(player.id)
      if (cancelled) return
      setSeasons(list)
      // An unknown label in the URL falls back to the most recent season.
      const chosen = list.find(s => s.label === selectedLabel) ?? list[0] ?? null
      const result = await fetchAmateurProfile(player.id, chosen?.seasonId)
      if (cancelled) return
      setData(result)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [player.id, selectedLabel])
```

- [ ] **Step 3: Renderizar o seletor na faixa da equipe**

Dentro do bloco da faixa da equipe, depois do `<div>` com o nome e a temporada e antes do fechamento do `<button>`, acrescente:

```tsx
              {seasons.length > 1 && (
                <select
                  value={seasons.find(s => s.label === selectedLabel)?.label ?? seasons[0].label}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    const label = e.target.value
                    setSelectedLabel(label)
                    const sp = new URLSearchParams(Array.from(searchParams.entries()))
                    sp.set('season', encodeURIComponent(label))
                    window.history.replaceState(null, '', `?${sp.toString()}`)
                  }}
                  aria-label={t('seasonSelector')}
                  style={{
                    background: BG_CARD, color: '#fff', border: `1px solid ${BORDER}`,
                    fontSize: 10, padding: '2px 4px', fontFamily: 'inherit', flexShrink: 0,
                  }}
                >
                  {seasons.map(s => (
                    <option key={s.seasonId} value={s.label}>{s.label}</option>
                  ))}
                </select>
              )}
```

O `onClick` com `stopPropagation` existe porque a faixa inteira é um `<button>` que leva à aba Equipe — sem ele, abrir o seletor navegaria de aba junto.

**Com uma temporada só nada é renderizado** — que é o estado dos 24 jogadores hoje.

- [ ] **Step 4: Verificar tipos, lint e build**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5 && npm run lint 2>&1 | grep -A2 "AmateurProfile" | head -8 && npm run build 2>&1 | tail -3`
Expected: sem erros novos; build conclui.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/player/[id]/AmateurProfile.tsx" src/messages/
git commit -m "feat(amateur): season selector on the profile"
```

---

## Task 7: Verificação com o build de produção

**Files:** nenhum — verificação.

- [ ] **Step 1: Build e start, como o Railway faz**

```bash
npm run build && npx next start -p 3007
```

- [ ] **Step 2: Conferir o selo curto**

Abra `http://localhost:3007/es/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0`.
Expected: o selo verde lê **`Amador · SNP`** numa linha só, e o nome não é mais empurrado pra baixo. O widget de pontos lê `PUNTOS SNP`. Repita em `/pt/` e sem prefixo (inglês) — o texto do selo é o mesmo nos três, por design.

- [ ] **Step 3: Conferir que o seletor NÃO aparece**

Com uma temporada só no banco, nenhum seletor deve ser renderizado na faixa da equipe. Essa é a verificação possível hoje.

- [ ] **Step 4: Conferir o upload no admin**

Suba o ops (`cd apps/ops && npm run dev`, porta 3004), abra o perfil de um amador, clique em **Add photo** e escolha um PNG. Expected: a foto troca no admin e, ao recarregar o perfil público, aparece no hero com a URL contendo `?v=`.

Depois abra um jogador **profissional** no admin: nenhum botão de foto deve existir.

- [ ] **Step 5: Rodar a suíte dos arquivos tocados**

Run: `npx vitest run src/lib/__tests__/amateur-profile.test.ts src/lib/__tests__/amateur-seasons.test.ts apps/ops/src/app/api/internal/upload-player-avatar`
Expected: tudo verde.

- [ ] **Step 6: Screenshot pro operador**

Tire um screenshot do hero com o selo curto e mande junto do resumo.

---

## Nota sobre a temporada 26/27

Quando o elenco for confirmado, **não é preciso código**: é gerar os três CSVs e rodar

```bash
npx tsx scripts/import-amateur-season.ts --dir ./import/blue-padel-26-27 --team-slug blue-padel-mataro --team-name "Blue Padel Mataró" --season 26/27 --source snp --external-id blue-padel-mataro-2627 --competition "Series Nacionales de Pádel · Barcelona · Masculino 1000" --apply
```

Atenção ao `--external-id`: ele identifica a **equipe**, não a temporada. Como é a mesma equipe, reusar `blue-padel-mataro-2526` faria o upsert cair na linha existente — que é o comportamento correto. Um `external-id` novo criaria uma segunda equipe com o mesmo nome. Use o mesmo da 25/26.

Só depois disso o seletor de temporada pode ser verificado de verdade.
