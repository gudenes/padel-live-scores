# Jogador edita posição e raquete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O usuário cujo perfil de jogador foi aprovado edita, sozinho, a própria posição e raquete — e nada além disso.

**Architecture:** Uma rota `PATCH /api/me/player` é a única que escreve. Ela resolve o jogador pela sessão (`profiles.player_id`), nunca pelo corpo do request. Toda a decisão — validar o payload e planejar a troca de raquete — mora em duas funções puras testadas; a rota só executa o plano.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (service-role na rota, anon no browser), Auth.js (`auth()` de `@/auth`), next-intl (5 locales), Vitest.

**Spec:** [2026-09-12-jogador-edita-posicao-e-raquete-design.md](../specs/2026-09-12-jogador-edita-posicao-e-raquete-design.md)

---

## Contexto que o implementador precisa

**Onde rodar:** worktree `.worktrees/amateur-profiles`, branch `feat/player-self-edit`. **Sempre `cd` para esse caminho antes de qualquer comando** — o diretório principal do repo é compartilhado com outras sessões e frequentemente está em outro branch.

**A feature de que esta depende já está em produção.** Leia antes de começar:
- `src/lib/player-claim.ts` — tipos do vínculo, incluindo `MyPlayerLinked`.
- `src/app/api/me/player/route.ts` — o `GET` que já existe neste mesmo arquivo de rota. Você vai **adicionar** um `PATCH` a ele.
- `src/hooks/useMyPlayer.ts` — `useMyPlayer()` e `invalidateMyPlayer()`.

**Estilo da UI do usuário:** estilos inline, sem Tailwind, constantes de cor no topo do arquivo. Referência: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` e `src/components/ClaimProfileRow.tsx`.

**Cliente Supabase:** `createServerClient()` de `@/lib/supabase` na rota (service key, **passa por cima de RLS** — toda guarda tem que ser explícita no código). No browser, `supabase` de `@/lib/supabase` (anon).

**Duas notas de ambiente:**
- `npx tsc --noEmit -p tsconfig.json` tem **dois erros pré-existentes** em `src/lib/__tests__/push-copy.test.ts`. São esperados; ignore, não conserte.
- `npm run lint` tem erros pré-existentes espalhados pelo repo. Rode `npx eslint <arquivo>` nos seus arquivos em vez da suíte inteira.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/player-self-edit.ts` | Valida o corpo do PATCH. Onde mora a distinção ausente-vs-nulo |
| `src/lib/player-equipment.ts` | Decide quais escritas uma troca de raquete exige. Função pura |
| `src/lib/__tests__/player-self-edit.test.ts` | Testes da validação |
| `src/lib/__tests__/player-equipment.test.ts` | Testes do plano de troca |
| `src/app/api/me/player/route.ts` | Ganha um `PATCH` ao lado do `GET` existente |
| `src/components/EditMyPlayerSheet.tsx` | A folha com os dois controles |
| `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx` | Monta o botão Editar |
| `src/messages/{en,es,pt,it,fr}.json` | Textos |

---

### Task 1: Validação do payload

**Files:**
- Create: `src/lib/player-self-edit.ts`
- Test: `src/lib/__tests__/player-self-edit.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/__tests__/player-self-edit.test.ts
import { describe, it, expect } from 'vitest'
import { parseSelfEditPayload } from '../player-self-edit'

describe('parseSelfEditPayload', () => {
  it('accepts a side-only patch and leaves the racket untouched', () => {
    expect(parseSelfEditPayload({ side: 'drive' }))
      .toEqual({ ok: true, patch: { side: 'drive' } })
  })

  it('accepts a racket-only patch and leaves the side untouched', () => {
    expect(parseSelfEditPayload({ racketId: 'racket-1' }))
      .toEqual({ ok: true, patch: { racketId: 'racket-1' } })
  })

  it('accepts both at once', () => {
    expect(parseSelfEditPayload({ side: 'backhand', racketId: 'racket-1' }))
      .toEqual({ ok: true, patch: { side: 'backhand', racketId: 'racket-1' } })
  })

  // Esta é a regra que mais custa se errar: tratar ausente como nulo apaga a
  // raquete de quem só queria mudar a posição.
  it('does NOT clear the racket when racketId is absent', () => {
    const result = parseSelfEditPayload({ side: 'drive' })
    expect(result).toEqual({ ok: true, patch: { side: 'drive' } })
    expect('racketId' in (result as { patch: object }).patch).toBe(false)
  })

  it('does NOT clear the side when side is absent', () => {
    const result = parseSelfEditPayload({ racketId: 'racket-1' })
    expect('side' in (result as { patch: object }).patch).toBe(false)
  })

  it('clears the side on an explicit null', () => {
    expect(parseSelfEditPayload({ side: null }))
      .toEqual({ ok: true, patch: { side: null } })
  })

  it('clears the racket on an explicit null', () => {
    expect(parseSelfEditPayload({ racketId: null }))
      .toEqual({ ok: true, patch: { racketId: null } })
  })

  it('rejects a side outside the allowed values', () => {
    expect(parseSelfEditPayload({ side: 'left' }))
      .toEqual({ ok: false, error: 'bad_side', status: 400 })
  })

  it('rejects a non-string racketId', () => {
    expect(parseSelfEditPayload({ racketId: 42 }))
      .toEqual({ ok: false, error: 'bad_racket', status: 400 })
  })

  it('rejects an empty patch — nothing to do is a client bug, not a no-op', () => {
    expect(parseSelfEditPayload({}))
      .toEqual({ ok: false, error: 'empty', status: 400 })
  })

  it('ignores fields it does not own — a playerId in the body changes nothing', () => {
    expect(parseSelfEditPayload({ side: 'drive', playerId: 'someone-else', ranking: 1 }))
      .toEqual({ ok: true, patch: { side: 'drive' } })
  })

  it('rejects a non-object body', () => {
    expect(parseSelfEditPayload(null))
      .toEqual({ ok: false, error: 'empty', status: 400 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/player-self-edit.test.ts`
Expected: FAIL — `Failed to resolve import "../player-self-edit"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/player-self-edit.ts
// Valida o corpo do PATCH /api/me/player.
//
// Existe como função pura porque a regra que importa aqui é sutil e fácil de
// perder de vista na rota: CAMPO AUSENTE NÃO É CAMPO NULO. Se `racketId`
// ausente virasse `null`, um PATCH que só queria mudar a posição apagaria a
// raquete da pessoa — e o cliente não teria como saber que pediu isso.
//
// A outra razão é negativa: nada que não esteja nesta lista entra. Um corpo
// com `playerId`, `ranking` ou `is_captain` é simplesmente ignorado. A rota
// nunca lê o jogador do request — ele vem da sessão.

export type PlayerSide = 'drive' | 'backhand'

const ALLOWED_SIDES: readonly string[] = ['drive', 'backhand']

/** Só as chaves presentes são aplicadas. `null` limpa; ausente não mexe. */
export interface SelfEditPatch {
  side?: PlayerSide | null
  racketId?: string | null
}

export type SelfEditResult =
  | { ok: true; patch: SelfEditPatch }
  | { ok: false; error: 'bad_side' | 'bad_racket' | 'empty'; status: number }

export function parseSelfEditPayload(body: unknown): SelfEditResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'empty', status: 400 }
  }
  const raw = body as Record<string, unknown>
  const patch: SelfEditPatch = {}

  if ('side' in raw) {
    const v = raw.side
    if (v === null) {
      patch.side = null
    } else if (typeof v === 'string' && ALLOWED_SIDES.includes(v)) {
      patch.side = v as PlayerSide
    } else {
      return { ok: false, error: 'bad_side', status: 400 }
    }
  }

  if ('racketId' in raw) {
    const v = raw.racketId
    if (v === null) {
      patch.racketId = null
    } else if (typeof v === 'string' && v.length > 0) {
      patch.racketId = v
    } else {
      return { ok: false, error: 'bad_racket', status: 400 }
    }
  }

  // Um PATCH vazio é bug do cliente, não um no-op silencioso: devolver 200
  // esconderia um formulário que não está mandando o que acha que manda.
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'empty', status: 400 }
  }

  return { ok: true, patch }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/player-self-edit.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-self-edit.ts src/lib/__tests__/player-self-edit.test.ts
git commit -m "feat(self-edit): validate the PATCH payload, absent is not null"
```

---

### Task 2: Plano de troca de raquete

**Files:**
- Create: `src/lib/player-equipment.ts`
- Test: `src/lib/__tests__/player-equipment.test.ts`

Contexto: `player_equipment` é **histórico, não campo**. Uma atribuição ativa é a linha com `ended_at IS NULL`. Trocar de raquete fecha a ativa e abre outra no mesmo dia, para o histórico ficar contíguo — sem buraco e sem sobreposição. O ops faz o mesmo em `apps/ops/src/app/api/internal/player-equipment/route.ts`; leia para entender o modelo, mas **não copie** a validação de datas retroativas — aqui só existe "a partir de hoje".

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/__tests__/player-equipment.test.ts
import { describe, it, expect } from 'vitest'
import { planRacketChange } from '../player-equipment'

const TODAY = '2026-09-12'

describe('planRacketChange', () => {
  it('opens an assignment when there is none', () => {
    expect(planRacketChange({ activeRacketId: null, nextRacketId: 'r1', today: TODAY }))
      .toEqual({ endActive: false, insert: { racketId: 'r1', startedAt: TODAY } })
  })

  it('closes the active one and opens the new one on the same day', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: 'r2', today: TODAY }))
      .toEqual({ endActive: true, insert: { racketId: 'r2', startedAt: TODAY } })
  })

  it('closes without opening when clearing', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: null, today: TODAY }))
      .toEqual({ endActive: true, insert: null })
  })

  // Sem isto, salvar o formulário sem mexer na raquete fecharia a atribuição
  // atual e abriria uma idêntica todo dia, enchendo o histórico de lixo.
  it('does nothing when the racket did not change', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: 'r1', today: TODAY }))
      .toEqual({ endActive: false, insert: null })
  })

  it('does nothing when clearing an already-empty assignment', () => {
    expect(planRacketChange({ activeRacketId: null, nextRacketId: null, today: TODAY }))
      .toEqual({ endActive: false, insert: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/player-equipment.test.ts`
Expected: FAIL — `Failed to resolve import "../player-equipment"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/player-equipment.ts
// Decide quais escritas uma troca de raquete exige. Pura de propósito: a
// parte difícil aqui não é falar com o banco, é não sujar o histórico.
//
// `player_equipment` é uma tabela de histórico. A atribuição ativa é a linha
// com `ended_at IS NULL`. Trocar fecha a ativa e abre a nova NO MESMO DIA,
// para o histórico ficar contíguo — sem buraco e sem sobreposição.
//
// O caminho do ops (apps/ops/.../player-equipment/route.ts) faz o mesmo e
// ainda valida datas retroativas, que aqui não existem: o jogador só edita
// "a partir de hoje". A duplicação é deliberada e está registrada no spec.

export interface RacketChangeInput {
  /** Raquete da atribuição ativa, ou null se não houver nenhuma. */
  activeRacketId: string | null
  /** Raquete desejada. null = limpar. */
  nextRacketId: string | null
  /** Data ISO `YYYY-MM-DD`. Recebida como parâmetro para o plano ser testável. */
  today: string
}

export interface RacketChangePlan {
  /** Fechar a atribuição ativa com `ended_at = today`. */
  endActive: boolean
  /** Nova atribuição a inserir, ou null. */
  insert: { racketId: string; startedAt: string } | null
}

export function planRacketChange(input: RacketChangeInput): RacketChangePlan {
  const { activeRacketId, nextRacketId, today } = input

  // Salvar o formulário sem ter mexido na raquete não pode gerar escrita
  // nenhuma. Sem esta guarda, cada salvamento fecharia a atribuição atual e
  // abriria uma idêntica, e o histórico viraria uma linha por clique.
  if (activeRacketId === nextRacketId) {
    return { endActive: false, insert: null }
  }

  return {
    endActive: activeRacketId !== null,
    insert: nextRacketId ? { racketId: nextRacketId, startedAt: today } : null,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/player-equipment.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-equipment.ts src/lib/__tests__/player-equipment.test.ts
git commit -m "feat(self-edit): pure plan for a racket change"
```

---

### Task 3: O PATCH

**Files:**
- Modify: `src/app/api/me/player/route.ts` (adicionar `PATCH`; não alterar o `GET`)

- [ ] **Step 1: Adicionar o handler**

Acrescente os imports que faltarem no topo do arquivo:

```ts
import type { NextRequest } from 'next/server'
import { parseSelfEditPayload } from '@/lib/player-self-edit'
import { planRacketChange } from '@/lib/player-equipment'
```

E o handler ao final do arquivo:

```ts
// PATCH — o jogador vinculado edita a própria posição e raquete.
//
// O id do jogador NUNCA vem do request: sai de profiles.player_id, que só o
// operador escreve ao aprovar uma claim. Não há como apontar esta rota para
// outra pessoa. Se o operador desvincular a conta, o próximo PATCH cai em
// 403 — o vínculo É a permissão, não há uma segunda lista para manter em dia.
export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = parseSelfEditPayload(await req.json().catch(() => null))
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { patch } = parsed

  const supabase = createServerClient()

  const { data: profile, error: profileErr } = await supabase
    .from('profiles').select('player_id').eq('id', userId).maybeSingle()
  if (profileErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!profile?.player_id) return NextResponse.json({ error: 'not_linked' }, { status: 403 })
  const playerId = profile.player_id as string

  // Validar a raquete ANTES de qualquer escrita. Um id inexistente tem que
  // sair com 400 sem ter tocado no banco — não com a posição já gravada e a
  // raquete não.
  if (patch.racketId) {
    const { data: racket, error: racketErr } = await supabase
      .from('padel_rackets').select('id').eq('id', patch.racketId).maybeSingle()
    if (racketErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    if (!racket) return NextResponse.json({ error: 'bad_racket' }, { status: 400 })
  }

  if ('side' in patch) {
    const { error } = await supabase
      .from('players').update({ side: patch.side ?? null }).eq('id', playerId)
    if (error) return NextResponse.json({ error: 'write_failed' }, { status: 500 })
  }

  if ('racketId' in patch) {
    const { data: active, error: activeErr } = await supabase
      .from('player_equipment').select('racket_id')
      .eq('player_id', playerId).is('ended_at', null).maybeSingle()
    if (activeErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })

    const today = new Date().toISOString().split('T')[0]
    const plan = planRacketChange({
      activeRacketId: (active?.racket_id as string | undefined) ?? null,
      nextRacketId: patch.racketId ?? null,
      today,
    })

    if (plan.endActive) {
      const { error } = await supabase
        .from('player_equipment').update({ ended_at: today })
        .eq('player_id', playerId).is('ended_at', null)
      if (error) return NextResponse.json({ error: 'write_failed' }, { status: 500 })
    }
    if (plan.insert) {
      const { error } = await supabase.from('player_equipment').insert({
        player_id: playerId,
        racket_id: plan.insert.racketId,
        started_at: plan.insert.startedAt,
        ended_at: null,
      })
      if (error) return NextResponse.json({ error: 'write_failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nenhum erro citando `src/app/api/me/player/route.ts`. Os dois erros em `src/lib/__tests__/push-copy.test.ts` são pré-existentes — ignore.

Run: `npx eslint src/app/api/me/player/route.ts` — sem saída.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/me/player/route.ts
git commit -m "feat(self-edit): PATCH /api/me/player for side and racket"
```

---

### Task 4: Textos nos 5 locales

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Adicionar as chaves ao namespace `amateur`**, depois de `claimFailed`.

`en.json`:
```json
"editCta": "Edit",
"editTitle": "My details",
"editPosition": "Position",
"editRacket": "Racket",
"editNone": "Not set",
"editSave": "Save",
"editSaving": "Saving…",
"editFailed": "Couldn't save. Try again."
```

`es.json`: `"editCta": "Editar"`, `"editTitle": "Mis datos"`, `"editPosition": "Posición"`, `"editRacket": "Pala"`, `"editNone": "Sin definir"`, `"editSave": "Guardar"`, `"editSaving": "Guardando…"`, `"editFailed": "No se pudo guardar. Inténtalo de nuevo."`

`pt.json`: `"editCta": "Editar"`, `"editTitle": "Meus dados"`, `"editPosition": "Posição"`, `"editRacket": "Raquete"`, `"editNone": "Não definido"`, `"editSave": "Salvar"`, `"editSaving": "Salvando…"`, `"editFailed": "Não foi possível salvar. Tente de novo."`

`it.json`: `"editCta": "Modifica"`, `"editTitle": "I miei dati"`, `"editPosition": "Posizione"`, `"editRacket": "Racchetta"`, `"editNone": "Non impostato"`, `"editSave": "Salva"`, `"editSaving": "Salvataggio…"`, `"editFailed": "Impossibile salvare. Riprova."`

`fr.json`: `"editCta": "Modifier"`, `"editTitle": "Mes informations"`, `"editPosition": "Position"`, `"editRacket": "Raquette"`, `"editNone": "Non renseigné"`, `"editSave": "Enregistrer"`, `"editSaving": "Enregistrement…"`, `"editFailed": "Impossible d'enregistrer. Réessayez."`

Preserve a indentação de cada arquivo. Não reordene chaves existentes, não deixe o editor reformatar o documento.

- [ ] **Step 2: Verificar**

```bash
node -e "
for (const l of ['en','es','pt','it','fr']) {
  const m = require('./src/messages/'+l+'.json');
  const miss = ['editCta','editTitle','editPosition','editRacket','editNone','editSave','editSaving','editFailed'].filter(k => !m.amateur?.[k]);
  console.log(l, miss.length ? 'MISSING '+miss.join(',') : 'ok');
}
"
```
Expected: cinco linhas `ok`.

Depois `git diff --stat`: exatamente 5 arquivos, ~8 inserções cada, **0 deleções**. Se algum tiver deleções, você reformatou — desfaça e refaça à mão.

- [ ] **Step 3: Commit**

```bash
git add src/messages
git commit -m "i18n(self-edit): edit sheet strings in 5 locales"
```

---

### Task 5: A folha de edição

**Files:**
- Create: `src/components/EditMyPlayerSheet.tsx`

O catálogo tem **68 raquetes em 15 marcas** — cabe numa lista agrupada, sem busca. `padel_rackets` e `padel_brands` têm policy `FOR SELECT USING (true)`, então o browser lê direto com o cliente anon; não existe rota de leitura para isso e não se deve criar uma.

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// src/components/EditMyPlayerSheet.tsx
// Folha de edição do próprio perfil: posição e raquete.
//
// Um lugar só, de propósito. A alternativa — tornar o widget de posição e o
// PlaysWithCard editáveis no lugar — deixaria dois componentes que renderizam
// tanto para o dono quanto para visitantes, com o modo dependendo de quem
// olha. É onde bug de permissão nasce.
//
// O catálogo (68 raquetes, 15 marcas) vem direto do cliente anon: as duas
// tabelas são públicas para leitura. Não há busca porque não há catálogo que
// a justifique.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const MUTED = '#8A8A8A'
const CARD = '#141414'
const BG = '#0A0A0A'
const BORDER = '#1C1C1C'
const RED = '#FF4655'

type Side = 'drive' | 'backhand' | null

interface RacketRow {
  id: string
  model: string | null
  year: number | null
  brand: { name: string } | null
}

export interface EditMyPlayerSheetProps {
  open: boolean
  onClose: () => void
  /** Valor atual, para o formulário abrir no estado certo. */
  initialSide: Side
  initialRacketId: string | null
  /** Chamado depois de salvar com sucesso, para a página recarregar os dados. */
  onSaved: () => void
}

export function EditMyPlayerSheet({
  open, onClose, initialSide, initialRacketId, onSaved,
}: EditMyPlayerSheetProps) {
  const t = useTranslations('amateur')
  const [side, setSide] = useState<Side>(initialSide)
  const [racketId, setRacketId] = useState<string | null>(initialRacketId)
  const [rackets, setRackets] = useState<RacketRow[]>([])
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reabrir a folha tem que refletir o que está gravado, não o que o usuário
  // digitou e abandonou da última vez.
  useEffect(() => {
    if (!open) return
    setSide(initialSide)
    setRacketId(initialRacketId)
    setFailed(false)
  }, [open, initialSide, initialRacketId])

  useEffect(() => {
    if (!open || rackets.length > 0) return
    let cancelled = false
    supabase
      .from('padel_rackets')
      .select('id, model, year, brand:padel_brands(name)')
      .order('model')
      .then(({ data }) => {
        if (cancelled) return
        setRackets((data ?? []) as unknown as RacketRow[])
      })
    return () => { cancelled = true }
  }, [open, rackets.length])

  if (!open) return null

  const byBrand = new Map<string, RacketRow[]>()
  for (const r of rackets) {
    const key = r.brand?.name ?? '—'
    const list = byBrand.get(key) ?? []
    list.push(r)
    byBrand.set(key, list)
  }
  const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b))

  const save = async () => {
    setSaving(true)
    setFailed(false)
    // Manda os dois campos sempre: a folha edita os dois, então ambos são
    // intencionais. Omitir um só faria sentido num formulário parcial.
    const res = await fetch('/api/me/player', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, racketId }),
    }).catch(() => null)
    setSaving(false)
    if (res && res.ok) {
      onSaved()
      onClose()
      return
    }
    setFailed(true)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={t('editTitle')}
        style={{
          background: BG, width: '100%', maxWidth: 500, maxHeight: '85dvh',
          overflowY: 'auto', borderTop: `1px solid ${BORDER}`, padding: '16px 14px 24px',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 14 }}>
          {t('editTitle')}
        </div>

        <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          {t('editPosition')}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {([['drive', t('sideDrive')], ['backhand', t('sideBackhand')], [null, t('editNone')]] as const).map(
            ([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSide(value as Side)}
                style={{
                  flex: 1, padding: '9px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: side === value ? ORANGE : CARD,
                  color: side === value ? '#1a0d00' : '#fff',
                  border: 'none', font: 'inherit',
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          {t('editRacket')}
        </div>
        <button
          type="button"
          onClick={() => setRacketId(null)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4,
            background: racketId === null ? ORANGE : CARD, color: racketId === null ? '#1a0d00' : MUTED,
            border: 'none', fontSize: 11, cursor: 'pointer', font: 'inherit',
          }}
        >
          {t('editNone')}
        </button>
        {brands.map(brand => (
          <div key={brand} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              {brand}
            </div>
            {(byBrand.get(brand) ?? []).map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRacketId(r.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 3,
                  background: racketId === r.id ? ORANGE : CARD,
                  color: racketId === r.id ? '#1a0d00' : '#fff',
                  border: 'none', fontSize: 11, cursor: 'pointer', font: 'inherit',
                }}
              >
                {r.model ?? r.id}{r.year ? ` · ${r.year}` : ''}
              </button>
            ))}
          </div>
        ))}

        {failed && (
          <div role="alert" style={{ color: RED, fontSize: 11, marginTop: 12 }}>
            {t('editFailed')}
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            width: '100%', marginTop: 18, padding: '12px 0', background: GREEN, color: '#173404',
            border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer', font: 'inherit',
          }}
        >
          {saving ? t('editSaving') : t('editSave')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` — nenhum erro citando o arquivo novo.
Run: `npx eslint src/components/EditMyPlayerSheet.tsx` — sem saída. Se a regra `react-hooks` reclamar do efeito, conserte o código; não adicione comentário de disable sem explicar.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditMyPlayerSheet.tsx
git commit -m "feat(self-edit): edit sheet for position and racket"
```

---

### Task 6: O botão Editar no perfil

**Files:**
- Modify: `src/app/[locale]/player/[id]/amateur/SummaryTab.tsx`

- [ ] **Step 1: Montar**

Adicione os imports junto dos outros:

```tsx
import { EditMyPlayerSheet } from '@/components/EditMyPlayerSheet'
import { useMyPlayer } from '@/hooks/useMyPlayer'
```

Dentro do componente `SummaryTab`, junto do `useState` que já existe para `suggestOpen`:

```tsx
  const [editOpen, setEditOpen] = useState(false)
  const mine = useMyPlayer()
  // O botão só existe para o dono do perfil. Visitante não vê nada — não há
  // modo de edição desabilitado, há ausência.
  const isMine = mine.status === 'linked' && mine.player.id === player.id
```

Logo **antes** do bloco de sugerir correção (o `<div>` com `border: '1px dashed #2A2A2A'` que contém `t('suggestPrompt')`), insira:

```tsx
      {isMine && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setEditOpen(true)}
            style={{
              background: 'none', border: `1px solid ${ORANGE}`, color: ORANGE,
              padding: '5px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 0.5, font: 'inherit',
            }}
          >
            {t('editCta')}
          </button>
        </div>
      )}
```

E, junto do `<SuggestChangesSheet …>` no fim do JSX:

```tsx
      <EditMyPlayerSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialSide={player.side === 'drive' || player.side === 'backhand' ? player.side : null}
        initialRacketId={racket?.id ?? null}
        onSaved={() => window.location.reload()}
      />
```

Sobre o `window.location.reload()`: os dados do perfil amador são carregados por um efeito em `AmateurProfile.tsx` que não expõe um refetch, e a raquete vem de outro efeito ainda. Recarregar é grosseiro mas honesto — a alternativa seria levantar estado por dois componentes só para este caso. Se a edição virar algo frequente, aí vale o refetch.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` — nenhum erro no arquivo.
Run: `npx eslint "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"` — sem saída.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/player/[id]/amateur/SummaryTab.tsx"
git commit -m "feat(self-edit): edit button on your own amateur profile"
```

---

### Task 7: Verificação manual

Só o operador pode rodar isto, e só depois do deploy. Não tente executar.

- [ ] **Step 1: Rodar a suíte**

```bash
npx vitest run src/lib/__tests__/player-self-edit.test.ts src/lib/__tests__/player-equipment.test.ts
```
Expected: 17 testes verdes (12 + 5).

- [ ] **Step 2: Registrar o que NÃO virou teste**

O spec pede testes de rota (401 sem sessão, 403 não vinculada, 400 com raquete inexistente **e nada gravado**). Eles não existem: o repo não tem harness de integração com banco, e testá-los com o Supabase mockado provaria o mock. Duas dessas três propriedades estão garantidas por ordenação no código, não por teste — a validação da raquete roda antes de qualquer escrita, e a resolução do jogador vem da sessão antes de tudo. Diga isso ao controlador em vez de deixar implícito.

- [ ] **Step 3: Escrever o roteiro para o operador**

Ao terminar, reporte ao controlador este roteiro para o operador executar em produção, com a conta dele vinculada a um amador de teste:

1. Abrir o próprio perfil → botão **Editar** aparece no fim da aba Resumo. Abrir o perfil de outro amador → **não** aparece.
2. Definir a posição, salvar, e ver o chip de posição mudar.
3. Escolher uma raquete, salvar, e ver o card "Joga com" aparecer.
4. Trocar para outra raquete e conferir no banco que a anterior ficou com `ended_at` de hoje:
   `select racket_id, started_at, ended_at from player_equipment where player_id = '<uuid>' order by started_at;`
5. Salvar sem mexer em nada e conferir que **nenhuma linha nova** apareceu.
6. Limpar a raquete e conferir que a ativa fechou sem abrir outra.
7. Desvincular no admin e confirmar que o botão Editar some.
