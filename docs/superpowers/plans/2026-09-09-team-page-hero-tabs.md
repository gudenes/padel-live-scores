# Página de equipe — hero e abas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar `/snp/[slug]` ao padrão visual da página de torneio — hero com capa e escudo, e três abas — sem perder o que a torna indexável.

**Architecture:** O Server Component continua buscando os dados e emitindo metadata; um shell client recebe tudo por props e cuida das abas. As três abas renderizam no DOM com as inativas escondidas por CSS, para o plantel e o calendário não sumirem do HTML servido. Capa e escudo entram por uma rota de upload no ops, com uma tela mínima de equipe que só edita imagens e rótulos.

**Tech Stack:** Next.js 16 (Server + Client Components), React 19, TypeScript, Supabase Storage, Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-09-team-page-hero-tabs-design.md`](../specs/2026-09-09-team-page-hero-tabs-design.md)

**Branch:** `feat/amateur-admin-v2` · worktree `.worktrees/amateur-profiles`

---

## Pré-requisito

`apps/ops` é pacote npm próprio e suas dependências já estão instaladas neste worktree. Testes do ops rodam de dentro dele:

```bash
cd apps/ops && npx vitest run <caminho> --root . ; cd ../..
```

Rodar da raiz falha ao resolver o alias `@/` — quirk conhecido e pré-existente.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260909200000_team_cover.sql` | `teams.cover_image_url` |
| `apps/ops/src/lib/team-image.ts` | Bucket `teams` + extensão a partir do MIME |
| `apps/ops/src/app/api/internal/upload-team-image/route.ts` | Upload de capa/escudo |
| `apps/ops/src/app/api/internal/team/[id]/route.ts` | GET + PATCH da equipe |
| `apps/ops/src/app/(app)/teams/page.tsx` | Lista de equipes |
| `apps/ops/src/app/(app)/teams/[id]/page.tsx` | Editor: imagens + rótulos |
| `apps/ops/src/components/shell/Rail.tsx` | **Modificar** — link no grupo Catalogs |
| `apps/ops/src/lib/command-palette.ts` | **Modificar** — entrada no ⌘K |
| `src/lib/amateur-profile.ts` | **Modificar** — `cover_image_url` no tipo e no select |
| `src/app/[locale]/snp/[slug]/TeamPageShell.tsx` | Hero + abas (client) |
| `src/app/[locale]/snp/[slug]/page.tsx` | **Modificar** — delega ao shell |
| `src/messages/{en,es,pt,it,fr}.json` | **Modificar** — 3 rótulos de aba |

---

## Task 1: Coluna da capa

**Files:**
- Create: `supabase/migrations/20260909200000_team_cover.sql`
- Modify: `src/lib/amateur-profile.ts`

- [ ] **Step 1: Migração**

```sql
-- 20260909200000_team_cover.sql
-- Cover image for the public team page hero. Nullable: without it the hero
-- falls back to a brand gradient, which is the state of every team today.

alter table public.teams
  add column if not exists cover_image_url text;

comment on column public.teams.cover_image_url is
  'Hero background for /snp/<slug>. Null = brand gradient fallback.';
```

- [ ] **Step 2: Aplicar**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260909200000_team_cover.sql`
Expected: `Applied.`

- [ ] **Step 3: Levar a coluna ao tipo e à query**

Em `src/lib/amateur-profile.ts`, no bloco `team` de `AmateurRawRows`, depois de `crest_url`:

```ts
    cover_image_url: string | null
```

E acrescente `cover_image_url` às **duas** listas de colunas de `teams` — a de `fetchAmateurProfile` e a de `fetchTeamSeason`. Localize-as com:

Run: `grep -n "crest_url" src/lib/amateur-profile.ts`

Os testes existentes têm um fixture de `team`; acrescente `cover_image_url: null` a ele para o tipo fechar.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npx vitest run src/lib/__tests__/team-season.test.ts src/lib/__tests__/amateur-profile.test.ts 2>&1 | grep -E "Tests|Test Files"`
Expected: sem erros; 13 testes passando.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909200000_team_cover.sql src/lib/amateur-profile.ts src/lib/__tests__/
git commit -m "feat(team): cover image column"
```

---

## Task 2: Rota de upload de imagem de equipe

**Files:**
- Create: `apps/ops/src/lib/team-image.ts`
- Create: `apps/ops/src/app/api/internal/upload-team-image/route.ts`
- Test: `apps/ops/src/app/api/internal/upload-team-image/__tests__/route.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/ops/src/app/api/internal/upload-team-image/__tests__/route.test.ts
// Cover and crest upload for a team. Mirrors upload-equipment-image: validate,
// store, return a URL — the DB write is the caller's PATCH.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, uploadResult } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  uploadResult: { value: { error: null } as unknown },
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

const TEAM_ID = '11111111-2222-3333-4444-555555555555'

function form(file: File | null, kind = 'cover', teamId = TEAM_ID): Request {
  const f = new FormData()
  if (file) f.set('file', file)
  f.set('kind', kind)
  f.set('teamId', teamId)
  return new Request('http://localhost/api/internal/upload-team-image', { method: 'POST', body: f })
}

const png = (bytes: number) => new File([new Uint8Array(bytes)], 'a.png', { type: 'image/png' })

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  uploadResult.value = { error: null }
  serviceClientMock.mockReturnValue({
    storage: {
      createBucket: () => Promise.resolve({ error: null }),
      from: () => ({ upload: () => Promise.resolve(uploadResult.value) }),
    },
  })
})

describe('POST /api/internal/upload-team-image', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    expect((await POST(form(png(10)))).status).toBe(401)
  })

  it('rejects an unknown kind', async () => {
    const res = await POST(form(png(10), 'mascot'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/kind/i)
  })

  it('rejects a teamId that is not a uuid', async () => {
    expect((await POST(form(png(10), 'cover', 'nope'))).status).toBe(400)
  })

  it('rejects an unsupported file type', async () => {
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    const res = await POST(form(gif))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/type/i)
  })

  it('rejects a file over 2 MB', async () => {
    const res = await POST(form(png(2 * 1024 * 1024 + 1)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/large/i)
  })

  it('returns a cache-busted url keyed by kind and team', async () => {
    const res = await POST(form(png(10), 'crest'))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    // Key is stable per team AND kind, so without ?v= a replacement image
    // would stay masked by the CDN.
    expect(url).toContain(`/teams/crest-${TEAM_ID}.png`)
    expect(url).toMatch(/\?v=\d+$/)
  })

  it('surfaces a storage failure as a 500', async () => {
    uploadResult.value = { error: { message: 'boom' } }
    expect((await POST(form(png(10)))).status).toBe(500)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/ops && npx vitest run src/app/api/internal/upload-team-image --root . ; cd ../..`
Expected: FAIL — não resolve `../route`.

- [ ] **Step 3: Implementar o helper**

```ts
// apps/ops/src/lib/team-image.ts
// Storage helpers for team images. Separate bucket from `avatars` (people) and
// `equipment` (rackets) so a retention or access change on one never surprises
// the others.

import type { SupabaseClient } from '@supabase/supabase-js'

export const TEAM_BUCKET = 'teams'
export type TeamImageKind = 'cover' | 'crest'

export function isTeamImageKind(value: string): value is TeamImageKind {
  return value === 'cover' || value === 'crest'
}

export function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

/** Creates the bucket on first use; treats "already exists" as success. */
export async function ensureTeamBucket(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(TEAM_BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Implementar a rota**

```ts
// apps/ops/src/app/api/internal/upload-team-image/route.ts
// Multipart upload of a team's cover or crest. Stores it in the `teams` bucket
// as {kind}-{teamId}.{ext} and returns the public URL. Does NOT write the DB
// row — the caller persists it with PATCH /api/internal/team/[id], the same
// split upload-equipment-image uses.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { ensureTeamBucket, isTeamImageKind, pickExtension, TEAM_BUCKET } from '@/lib/team-image'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
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

  const kind = String(form.get('kind') ?? '')
  const teamId = String(form.get('teamId') ?? '')
  const file = form.get('file')

  if (!isTeamImageKind(kind)) {
    return Response.json({ error: 'kind must be "cover" or "crest"' }, { status: 400 })
  }
  if (!isUuid(teamId)) {
    return Response.json({ error: 'teamId must be a uuid' }, { status: 400 })
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

  const bucket = await ensureTeamBucket(supabase)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  const ext = pickExtension(file.type)
  const filePath = `${kind}-${teamId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from(TEAM_BUCKET)
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  // ?v= is load-bearing: the key is stable per team and kind, so a replacement
  // image would otherwise be masked by the CDN and by next/image's cache.
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TEAM_BUCKET}/${filePath}` +
    `?v=${Date.now()}`

  return Response.json({ url })
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/ops && npx vitest run src/app/api/internal/upload-team-image --root . ; cd ../..`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/lib/team-image.ts apps/ops/src/app/api/internal/upload-team-image/
git commit -m "feat(ops): team cover and crest upload route"
```

---

## Task 3: Rota GET/PATCH da equipe

**Files:**
- Create: `apps/ops/src/app/api/internal/team/[id]/route.ts`
- Test: `apps/ops/src/app/api/internal/team/[id]/__tests__/route.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/ops/src/app/api/internal/team/[id]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, updateSpy } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  updateSpy: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { PATCH } from '../route'

const TEAM_ID = '11111111-2222-3333-4444-555555555555'
const params = Promise.resolve({ id: TEAM_ID })

function patch(body: unknown): Request {
  return new Request(`http://localhost/api/internal/team/${TEAM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  updateSpy.mockReset()
  serviceClientMock.mockReturnValue({
    from: () => ({
      update: (payload: unknown) => { updateSpy(payload); return { eq: () => Promise.resolve({ error: null }) } },
    }),
  })
})

describe('PATCH /api/internal/team/[id]', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    expect((await PATCH(patch({ city: 'Mataró' }), { params })).status).toBe(401)
  })

  it('rejects a field outside the allow-list', async () => {
    // Failing loudly beats silently dropping the field — a silent drop looks
    // like a save that worked.
    const res = await PATCH(patch({ slug: 'hijacked' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/slug/)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('writes the allow-listed fields', async () => {
    const res = await PATCH(patch({ city: 'Mataró', country: 'ES', short_name: 'SNP' }), { params })
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({ city: 'Mataró', country: 'ES', short_name: 'SNP' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/ops && npx vitest run src/app/api/internal/team --root . ; cd ../..`
Expected: FAIL — não resolve `../route`.

- [ ] **Step 3: Implementar**

```ts
// apps/ops/src/app/api/internal/team/[id]/route.ts
// Team read + narrow update for the ops team editor.
//
// There is no POST and no DELETE on purpose: teams come from the season
// import. A create button here would produce orphan teams with no season, no
// roster and no fixtures — objects the public page cannot render.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const PATCHABLE_FIELDS = new Set([
  'badge_label',
  'short_name',
  'city',
  'country',
  'cover_image_url',
  'crest_url',
])

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const { data, error } = await serviceClient()
    .from('teams')
    .select('id, slug, name, club, city, country, competition, category, badge_label, short_name, crest_url, cover_image_url')
    .eq('id', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Team not found' }, { status: 404 })
  return Response.json({ team: data })
}

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Expected JSON body' }, { status: 400 })
  }

  const unknownFields = Object.keys(body).filter(k => !PATCHABLE_FIELDS.has(k))
  if (unknownFields.length > 0) {
    return Response.json({ error: `Unknown fields: ${unknownFields.join(', ')}` }, { status: 400 })
  }
  if (Object.keys(body).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await serviceClient().from('teams').update(body).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/ops && npx vitest run src/app/api/internal/team --root . ; cd ../..`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/api/internal/team/"
git commit -m "feat(ops): team read and narrow update route"
```

---

## Task 4: Telas de equipe no ops

**Files:**
- Create: `apps/ops/src/app/(app)/teams/page.tsx`
- Create: `apps/ops/src/app/(app)/teams/[id]/TeamEditor.tsx`
- Create: `apps/ops/src/app/(app)/teams/[id]/page.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx`
- Modify: `apps/ops/src/lib/command-palette.ts`

- [ ] **Step 1: A lista**

```tsx
// apps/ops/src/app/(app)/teams/page.tsx
// Team list. Read-only: teams are created by the season import, never here.

import Link from 'next/link'
import { serviceClient } from '@/lib/supabase'
import { PageHeader, Panel } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  const { data: teams } = await serviceClient()
    .from('teams')
    .select('id, name, slug, competition, city')
    .order('name')

  return (
    <div className="ui-page">
      <PageHeader title="Teams" />
      <Panel>
        {(teams ?? []).length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 14, padding: 12 }}>
            No teams yet — they arrive with the season import.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--border-card)' }}>
            {(teams ?? []).map(t => (
              <Link
                key={t.id}
                href={`/teams/${t.id}`}
                style={{
                  background: 'var(--bg-card)', padding: '12px 14px',
                  textDecoration: 'none', color: 'inherit', display: 'grid', gap: 2,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{t.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {[t.competition, t.city].filter(Boolean).join(' · ') || t.slug}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
```

- [ ] **Step 2: O editor**

```tsx
'use client'
// apps/ops/src/app/(app)/teams/[id]/TeamEditor.tsx
// Images and labels for a team. No create, no delete — see the route comment.

import { useRef, useState } from 'react'

export interface EditableTeam {
  id: string
  name: string
  badge_label: string | null
  short_name: string | null
  city: string | null
  country: string | null
  crest_url: string | null
  cover_image_url: string | null
}

const FIELDS: Array<{ key: keyof EditableTeam; label: string; hint?: string }> = [
  { key: 'badge_label', label: 'Badge label', hint: 'Verbatim, same in every locale — e.g. "Amador · SNP"' },
  { key: 'short_name', label: 'Short name', hint: 'Compact competition reference — e.g. "SNP"' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country code', hint: 'ISO-2, e.g. ES' },
]

export default function TeamEditor({ team }: { team: EditableTeam }) {
  const [values, setValues] = useState(team)
  const [status, setStatus] = useState<string | null>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const crestRef = useRef<HTMLInputElement>(null)

  async function save(patch: Partial<EditableTeam>) {
    setStatus('Saving…')
    const res = await fetch(`/api/internal/team/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setStatus(res.ok ? 'Saved' : (await res.json()).error ?? 'Save failed')
  }

  async function upload(kind: 'cover' | 'crest', file: File) {
    setStatus('Uploading…')
    const form = new FormData()
    form.set('file', file)
    form.set('teamId', team.id)
    form.set('kind', kind)
    const up = await fetch('/api/internal/upload-team-image', { method: 'POST', body: form })
    const body = await up.json()
    if (!up.ok) { setStatus(body.error ?? 'Upload failed'); return }
    const field = kind === 'cover' ? 'cover_image_url' : 'crest_url'
    setValues(v => ({ ...v, [field]: body.url }))
    await save({ [field]: body.url })
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {(['cover', 'crest'] as const).map(kind => {
          const url = kind === 'cover' ? values.cover_image_url : values.crest_url
          const ref = kind === 'cover' ? coverRef : crestRef
          return (
            <div key={kind} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize' }}>{kind}</span>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={kind}
                  style={{
                    width: kind === 'cover' ? 260 : 90, height: 90, objectFit: 'cover',
                    border: '1px solid var(--border-card)', background: 'var(--bg-hover)',
                  }}
                />
              ) : (
                <div style={{
                  width: kind === 'cover' ? 260 : 90, height: 90,
                  border: '1px dashed var(--border-card)', background: 'var(--bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-3)', fontSize: 12,
                }}>
                  none
                </div>
              )}
              <input
                ref={ref}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) upload(kind, f)
                  // Allows re-uploading the same file twice in a row.
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => ref.current?.click()}
                style={{
                  padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)',
                }}
              >
                {url ? 'Replace' : 'Upload'}
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {FIELDS.map(f => (
          <label key={f.key} style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {f.label}
            </span>
            <input
              value={(values[f.key] as string | null) ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              onBlur={e => save({ [f.key]: e.target.value || null })}
              style={{
                padding: '7px 9px', fontSize: 13,
                border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)',
              }}
            />
            {f.hint && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.hint}</span>}
          </label>
        ))}
      </div>

      {status && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{status}</div>}
    </div>
  )
}
```

- [ ] **Step 3: A página do editor**

```tsx
// apps/ops/src/app/(app)/teams/[id]/page.tsx
import { notFound } from 'next/navigation'
import { serviceClient } from '@/lib/supabase'
import { PageHeader, Panel } from '@/components/ui'
import TeamEditor, { type EditableTeam } from './TeamEditor'

export const dynamic = 'force-dynamic'

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data } = await serviceClient()
    .from('teams')
    .select('id, name, badge_label, short_name, city, country, crest_url, cover_image_url')
    .eq('id', id)
    .single()

  if (!data) notFound()

  return (
    <div className="ui-page">
      <PageHeader title={data.name} />
      <Panel>
        <TeamEditor team={data as unknown as EditableTeam} />
      </Panel>
    </div>
  )
}
```

- [ ] **Step 4: Links de navegação**

Em `apps/ops/src/components/shell/Rail.tsx`, no grupo `Catalogs`, logo depois da entrada de `/players`:

```tsx
    { href: '/teams', label: 'Teams', icon: 'users' },
```

E em `apps/ops/src/lib/command-palette.ts`, acrescente uma entrada para `/teams` seguindo o formato das vizinhas — abra o arquivo e espelhe a entrada de `/players`.

- [ ] **Step 5: Verificar**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | head -5 ; npx eslint "src/app/(app)/teams" --ext .ts,.tsx 2>&1 | tail -5 ; cd ../..`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "apps/ops/src/app/(app)/teams/" apps/ops/src/components/shell/Rail.tsx apps/ops/src/lib/command-palette.ts
git commit -m "feat(ops): minimal team editor for images and labels"
```

---

## Task 5: Rótulos de aba no i18n

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Acrescentar três chaves ao namespace `team`**

`en`: `"tabOverview": "Overview"`, `"tabSquad": "Squad"`, `"tabRounds": "Rounds"`
`es`: `"Resumen"`, `"Plantilla"`, `"Jornadas"`
`pt`: `"Resumo"`, `"Plantel"`, `"Jornadas"`
`it`: `"Riepilogo"`, `"Rosa"`, `"Giornate"`
`fr`: `"Résumé"`, `"Effectif"`, `"Journées"`

- [ ] **Step 2: Verificar paridade**

```bash
node -e "
const l=['en','es','pt','it','fr'].map(x=>[x,require('./src/messages/'+x+'.json').team]);
const base=Object.keys(l[0][1]).sort();
for(const [n,o] of l){const k=Object.keys(o).sort();
 if(JSON.stringify(k)!==JSON.stringify(base)){console.error(n,'mismatch');process.exit(1)}}
console.log('all five carry the same', base.length, 'team keys');
"
```

Expected: `all five carry the same 21 team keys`

- [ ] **Step 3: Commit**

```bash
git add src/messages/
git commit -m "feat(team): tab labels"
```

---

## Task 6: Hero e abas na página pública

**Files:**
- Create: `src/app/[locale]/snp/[slug]/TeamPageShell.tsx`
- Modify: `src/app/[locale]/snp/[slug]/page.tsx`

- [ ] **Step 1: Criar o shell**

```tsx
'use client'
// src/app/[locale]/snp/[slug]/TeamPageShell.tsx
// Hero + tabs for the public team page.
//
// Receives everything as props — it fetches nothing. The page stays a Server
// Component so the HTML a crawler gets is complete.
//
// All three panels render into the DOM; inactive ones are hidden with CSS.
// Rendering only the active tab — the usual React pattern, and what the player
// profile does — would drop the squad and the calendar out of the served HTML
// and silently undo the reason this page is server-rendered. With 24 players
// and 42 courts the payload cost is irrelevant.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import { FlagImage } from '@/components/FlagImage'
import type { TeamSeasonPageData } from '@/lib/amateur-profile'
import { TeamRoster } from './TeamRoster'
import { TeamFixtures } from './TeamFixtures'

const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'

type Tab = 'overview' | 'squad' | 'rounds'

export function TeamPageShell({ data }: { data: TeamSeasonPageData }) {
  const t = useTranslations('team')
  const [tab, setTab] = useState<Tab>('overview')

  const totals = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: t('tabOverview') },
    { id: 'squad', label: t('tabSquad') },
    { id: 'rounds', label: t('tabRounds') },
  ]

  const cover = data.team.cover_image_url

  return (
    <>
      <div style={{
        position: 'relative', height: 190, display: 'flex', alignItems: 'flex-end',
        // Fixed height so the page does not jump as the cover loads. Without a
        // cover this is the brand gradient, which is every team today.
        background: cover
          ? `linear-gradient(to top, rgba(10,10,10,0.95) 10%, rgba(10,10,10,0.35) 60%, rgba(10,10,10,0.15)), url(${cover}) center/cover`
          : 'linear-gradient(160deg, rgba(126,211,33,0.22), rgba(245,166,35,0.12) 60%, #0A0A0A)',
      }}>
        <div style={{ padding: '0 16px 14px', width: '100%', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          {data.team.crest_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.team.crest_url}
              alt={data.team.name}
              style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
              {data.team.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: '#C9C9C9', fontSize: 12 }}>
              {data.team.country && <FlagImage country={data.team.country} size={16} />}
              <span>{[data.team.competition, data.team.city].filter(Boolean).join(' · ')}</span>
            </div>
            <div style={{ fontSize: 11, color: ORANGE, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {t('seasonLabel')} {data.season.label}
            </div>
          </div>
        </div>
      </div>

      <SlidingInkTabs<Tab>
        tabs={tabs.map(x => ({ key: x.id, label: x.label }))}
        activeKey={tab}
        onChange={setTab}
      />

      <div style={{ display: tab === 'overview' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {totals.map(x => (
            <div key={x.label} style={{
              flex: 1, background: BG_CARD, padding: '10px 6px', textAlign: 'center',
              clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                {x.value}
              </div>
              <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                {x.label}
              </div>
            </div>
          ))}
        </div>

        {data.season.notes && (
          <div style={{ marginTop: 14, background: BG_CARD, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
              {t('methodNote')}
            </div>
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
          </div>
        )}
      </div>

      <div style={{ display: tab === 'squad' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <TeamRoster roster={data.roster} />
      </div>

      <div style={{ display: tab === 'rounds' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <TeamFixtures fixtures={data.fixtures} roster={data.roster} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Enxugar a página**

Em `src/app/[locale]/snp/[slug]/page.tsx`, mantenha `generateMetadata`, o fetch, o `notFound()` e o JSON-LD **sem tocar**. Substitua todo o JSX do corpo — do cabeçalho até a nota de método — por:

```tsx
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>
        <TeamPageShell data={data} />
      </div>
```

Import: `import { TeamPageShell } from './TeamPageShell'`.

Remova de `page.tsx` os imports que ficaram sem uso — `FlagImage`, `TeamRoster`, `TeamFixtures`, `getTranslations` se não for mais usado pelo `generateMetadata`, e as constantes de cor que só o corpo usava. Confirme com `npm run lint` em vez de adivinhar.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -5 && npm run build 2>&1 | tail -3`
Expected: sem erros; build conclui.

- [ ] **Step 4: A verificação que não pode ser pulada**

Suba o build numa porta livre (o operador usa a 3007):

```bash
(npx next start -p 3011 &) && sleep 8
curl -s http://localhost:3011/es/snp/blue-padel-mataro | grep -c "Gustavo Denes"
curl -s http://localhost:3011/es/snp/blue-padel-mataro | grep -c "Jornada 1"
pkill -f "next start -p 3011"
```

Expected: **os dois maiores que zero.**

A aba ativa na primeira carga é Resumen, então o plantel e as jornadas estão escondidos por CSS. Se qualquer um dos dois vier zero, as abas passaram a esconder conteúdo do HTML e o SEO da página se perdeu — pare e conserte antes de commitar.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/snp/[slug]/"
git commit -m "feat(team): hero with cover and three tabs, all panels in the DOM"
```

---

## Task 7: Verificação final

**Files:** nenhum — verificação.

- [ ] **Step 1: Rebuild e restart da 3007**

```bash
pkill -f "next start -p 3007"; npm run build && (npx next start -p 3007 &)
```

- [ ] **Step 2: A página**

Abra `http://localhost:3007/es/snp/blue-padel-mataro` em viewport mobile. Confirme: hero com gradiente (ainda não há capa), nome, competição e temporada; três abas; Resumen com os três números e a nota; Plantilla com os 24; Jornadas com as 11 e os avisos de dupla incerta.

- [ ] **Step 3: O upload**

No ops (`http://localhost:3004/teams`), abra o Blue Padel, suba uma capa e um escudo, e preencha `city` = `Mataró` e `country` = `ES`. Recarregue a página pública: a capa deve estar no hero, o escudo ao lado do nome, e a bandeira espanhola na linha da competição.

- [ ] **Step 4: O cache-busting**

Suba uma **segunda** capa, diferente. Recarregue. Se a imagem antiga persistir, o `?v=` não está sendo aplicado — é o modo de falha que essa coluna existe para evitar.

- [ ] **Step 5: Console e rede**

`read_console_messages` e `read_network_requests`: sem erros, sem 4xx/5xx.

- [ ] **Step 6: Suíte**

Run: `npx vitest run src/lib/__tests__/ 2>&1 | grep -E "Tests|Test Files" ; cd apps/ops && npx vitest run src/app/api/internal/upload-team-image src/app/api/internal/team --root . 2>&1 | grep -E "Tests|Test Files" ; cd ../..`
Expected: tudo verde.

- [ ] **Step 7: Screenshot**

Do hero com a capa, para o operador.
