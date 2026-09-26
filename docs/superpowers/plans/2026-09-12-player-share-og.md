# Share do perfil + imagem de compartilhamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos perfis de jogador — profissional e amador — um botão de compartilhar e uma imagem de preview gerada, para que um link colado num grupo chegue como cartão em vez de URL crua.

**Architecture:** Uma rota `opengraph-image.tsx` sob o perfil, ramificando por `tier` num molde único, seguindo as lições já pagas pelo OG da partida. Um `ShareButton` compartilhado pelos dois perfis que envia só a URL — sem anexo de arquivo. A montagem da URL é função pura e testada, porque o inglês não leva prefixo de locale e errar isso produz link quebrado que ninguém revisa.

**Tech Stack:** Next.js 16 (`next/og` + Satori), React 19, TypeScript, Capacitor Share, Vitest, next-intl.

**Spec:** [`docs/superpowers/specs/2026-09-12-player-share-og-design.md`](../specs/2026-09-12-player-share-og-design.md)

**Branch:** `feat/amateur-admin-v2` · worktree `.worktrees/amateur-profiles`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/share-url.ts` | `buildShareUrl(locale, playerId)` — pura |
| `src/lib/__tests__/share-url.test.ts` | Testes dela |
| `src/components/ShareButton.tsx` | Botão: Capacitor → Web Share → clipboard |
| `src/app/[locale]/player/[id]/opengraph-image.tsx` | A imagem, ramificando por tier |
| `src/app/[locale]/player/[id]/page.tsx` | **Modificar** — botão no hero do pro |
| `src/app/[locale]/player/[id]/AmateurProfile.tsx` | **Modificar** — botão no hero do amador |
| `src/messages/{en,es,pt,it,fr}.json` | **Modificar** — `common.linkCopied` |

---

## Task 1: `buildShareUrl`

O inglês não leva prefixo (`localePrefix: 'as-needed'`). Verificado em produção: `/player/<id>` responde 200 e `/en/player/<id>` responde 307. Esta é a única lógica da feature onde um erro escapa da revisão.

**Files:**
- Create: `src/lib/share-url.ts`
- Test: `src/lib/__tests__/share-url.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/share-url.test.ts
import { describe, it, expect } from 'vitest'
import { buildShareUrl } from '../share-url'

const ID = '77ab6a3d-7484-46d2-b873-f90df0a4a1a0'

describe('buildShareUrl', () => {
  it('omits the prefix for the default locale', () => {
    // localePrefix is 'as-needed': /en/player/<id> is a 307, /player/<id> is
    // the real URL. Shipping the prefixed one means sharing a redirect.
    expect(buildShareUrl('en', ID)).toBe(`https://padelnachos.com/player/${ID}`)
  })

  it('includes the prefix for every other locale', () => {
    expect(buildShareUrl('es', ID)).toBe(`https://padelnachos.com/es/player/${ID}`)
    expect(buildShareUrl('pt', ID)).toBe(`https://padelnachos.com/pt/player/${ID}`)
    expect(buildShareUrl('it', ID)).toBe(`https://padelnachos.com/it/player/${ID}`)
    expect(buildShareUrl('fr', ID)).toBe(`https://padelnachos.com/fr/player/${ID}`)
  })

  it('falls back to no prefix for an unknown locale', () => {
    // A junk locale must not produce /xx/player/... — the unprefixed URL
    // always resolves, so it is the safe fallback.
    expect(buildShareUrl('xx', ID)).toBe(`https://padelnachos.com/player/${ID}`)
  })

  it('carries no query string', () => {
    // The profile URL picks up ?tab= and ?season= as the user navigates.
    // Sharing those would hand someone a view they never chose to share.
    expect(buildShareUrl('es', ID)).not.toContain('?')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/share-url.test.ts`
Expected: FAIL — `Failed to resolve import "../share-url"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/share-url.ts
// Canonical, shareable URL for a player profile.
//
// Built from the locale and the id rather than window.location.href: the
// live URL accumulates ?tab= and ?season= as the visitor navigates, and
// sharing those hands someone a view they never chose to share.

import { routing } from '@/i18n/routing'

const BASE_URL = 'https://padelnachos.com'

/**
 * `localePrefix` is 'as-needed', so the default locale has NO prefix:
 * /player/<id> resolves, /en/player/<id> is a 307. An unknown locale falls
 * back to the unprefixed form, which always resolves.
 */
export function buildShareUrl(locale: string, playerId: string): string {
  const known = (routing.locales as readonly string[]).includes(locale)
  const prefix = known && locale !== routing.defaultLocale ? `/${locale}` : ''
  return `${BASE_URL}${prefix}/player/${playerId}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/share-url.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-url.ts src/lib/__tests__/share-url.test.ts
git commit -m "feat(share): canonical player share URL, unprefixed for English"
```

---

## Task 2: i18n do aviso de cópia

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Acrescentar a chave no namespace `common`**

`en` `"linkCopied": "Link copied"` · `es` `"Enlace copiado"` · `pt` `"Link copiado"` · `it` `"Link copiato"` · `fr` `"Lien copié"`

`common.share` já existe nos cinco e é reaproveitado no `aria-label`.

- [ ] **Step 2: Verificar paridade**

```bash
node -e "
const l=['en','es','pt','it','fr'].map(x=>[x,require('./src/messages/'+x+'.json').common]);
const base=Object.keys(l[0][1]).sort();
for(const [n,o] of l){const k=Object.keys(o).sort();
 if(JSON.stringify(k)!==JSON.stringify(base)){console.error(n,'mismatch');process.exit(1)}
 if(!o.linkCopied||!o.share){console.error(n,'faltando linkCopied/share');process.exit(1)}}
console.log('os cinco locales têm linkCopied e share, com', base.length, 'chaves em common');
"
```

Expected: a linha de confirmação, sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/messages/
git commit -m "feat(share): link-copied string"
```

---

## Task 3: O `ShareButton`

**Files:**
- Create: `src/components/ShareButton.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// src/components/ShareButton.tsx
// Share a player profile. Sends the URL only — no Web Share Level 2 file
// attachment: attaching the PNG makes the target render a loose image with a
// link beside it instead of the familiar preview card, and a profile does not
// go stale in seconds the way a live score does. The platform fetches the OG
// image from the page metadata by itself.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

export default function ShareButton({
  url,
  size = 36,
  color = '#8A8A8A',
}: {
  url: string
  size?: number
  color?: string
}) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    // Order matters: navigator.share is undefined inside the Capacitor
    // WebView, so checking for it first would skip the native sheet.
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ url })
      } catch {
        // The user dismissed the sheet. Not an error.
      }
      return
    }

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ url })
      } catch (err) {
        // AbortError means the user closed the sheet — never surface that.
        if ((err as Error)?.name !== 'AbortError') {
          await copyToClipboard()
        }
      }
      return
    }

    await copyToClipboard()
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context, permissions). Nothing sensible
      // left to try, and a red error over a share button helps no one.
    }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={handleShare}
        aria-label={t('share')}
        style={{
          width: size, height: size, border: 'none', background: 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color, padding: 0,
        }}
      >
        <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>
      {copied && (
        <span style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#141414', color: '#fff', fontSize: 10,
          padding: '4px 8px', whiteSpace: 'nowrap', zIndex: 20,
        }}>
          {t('linkCopied')}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos e lint**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npx eslint src/components/ShareButton.tsx 2>&1 | tail -3`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/ShareButton.tsx
git commit -m "feat(share): share button with native, web-share and clipboard paths"
```

---

## Task 4: Ligar o botão nos dois perfis

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`
- Modify: `src/app/[locale]/player/[id]/AmateurProfile.tsx`

- [ ] **Step 1: Perfil profissional**

Em `page.tsx`, acrescente os imports:

```tsx
import { useLocale } from 'next-intl'
import ShareButton from '@/components/ShareButton'
import { buildShareUrl } from '@/lib/share-url'
```

Dentro do componente `PlayerPage`, junto dos outros hooks:

```tsx
  const locale = useLocale()
```

E no hero, imediatamente **antes** do `<FollowButton type="player" targetId={player.id} variant="follow" />`:

```tsx
            <ShareButton url={buildShareUrl(locale, player.id)} />
```

- [ ] **Step 2: Perfil amador**

Em `AmateurProfile.tsx`, os mesmos imports e o mesmo `const locale = useLocale()`, e o `ShareButton` antes do `FollowButton` do hero.

`useTranslations` já é importado de `next-intl` nos dois arquivos — acrescente `useLocale` ao mesmo import em vez de criar outro.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npm run lint 2>&1 | grep -cE "ShareButton|share-url" ; npm run build 2>&1 | tail -2`
Expected: sem erros de tipo, sem lint novo, build conclui.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx" "src/app/[locale]/player/[id]/AmateurProfile.tsx"
git commit -m "feat(share): share button on both player profiles"
```

---

## Task 5: A imagem de compartilhamento

**Files:**
- Create: `src/app/[locale]/player/[id]/opengraph-image.tsx`

- [ ] **Step 1: Criar a rota**

Leia primeiro [`src/app/[locale]/match/[id]/opengraph-image.tsx`](../../../src/app/[locale]/match/[id]/opengraph-image.tsx) — o cabeçalho dele documenta as três armadilhas que esta rota herda, e o código abaixo as reproduz de propósito.

```tsx
// src/app/[locale]/player/[id]/opengraph-image.tsx
// Dynamic OG image for player profiles — one card, two tiers.
//
// The frame is identical for professionals and amateurs; only the identity
// line and the four stat boxes change. Two separate files would drift.
//
// Three constraints inherited from the match OG route, each a bug already
// paid for there:
// - Direct fetch() against Supabase REST — @supabase/supabase-js blows past
//   next/og's 500 KB bundle budget.
// - The avatar is fetched by us and embedded as a base64 data URL. Satori
//   fetches <img src> itself at render time, so one slow or broken avatar
//   500s the whole route. WebP is refused: Satori is flaky with it.
// - Flags are emoji, which next/og renders through Twemoji.

import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// An hour, not the match route's 60s — a profile does not change per point.
export const revalidate = 3600

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG = '#0A0A0A'
const CARD = '#141414'
const MUTED = '#8A8A8A'

type PlayerRow = {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
  ranking: number | null
  titles: number | null
  win_rate: number | null
  total_matches: number | null
  points: number | null
  side: string | null
  tier: string | null
}

type MembershipRow = {
  competition_points: number | null
  games_played: number | null
  wins: number | null
  losses: number | null
  season: { label: string; team: { name: string; badge_label: string | null } | null } | null
}

async function fetchPlayer(id: string): Promise<PlayerRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = [
    'id', 'name', 'display_name', 'country', 'category', 'avatar_url',
    'ranking', 'titles', 'win_rate', 'total_matches', 'points', 'side', 'tier',
  ].join(',')

  const url = `${supaUrl}/rest/v1/players?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as PlayerRow[]
  return rows[0] ?? null
}

async function fetchMembership(playerId: string): Promise<MembershipRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = 'competition_points,games_played,wins,losses,season:team_seasons(label,team:teams(name,badge_label))'
  const url =
    `${supaUrl}/rest/v1/team_memberships?player_id=eq.${encodeURIComponent(playerId)}` +
    `&select=${encodeURIComponent(select)}&order=created_at.desc&limit=1`
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as MembershipRow[]
  return rows[0] ?? null
}

/** Satori accepts PNG, JPEG, GIF, SVG. WebP is flaky, so we refuse it. */
async function fetchAvatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.toLowerCase().includes('.webp')) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|jpg|gif|svg)/i.test(contentType)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 150_000) return null
    return `data:${contentType.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

function flagEmoji(country: string | null): string {
  if (!country || country.length !== 2) return ''
  const up = country.toUpperCase()
  return String.fromCodePoint(
    0x1f1e6 + up.charCodeAt(0) - 65,
    0x1f1e6 + up.charCodeAt(1) - 65,
  )
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const player = await fetchPlayer(id)

  if (!player) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', background: BG, display: 'flex',
          alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 40 }}>
          PadelNachos
        </div>
      ),
      size,
    )
  }

  const isAmateur = player.tier === 'amateur'
  const membership = isAmateur ? await fetchMembership(id) : null
  const avatar = await fetchAvatarDataUrl(player.avatar_url)
  const name = player.display_name?.trim() || player.name

  const badge = isAmateur
    ? (membership?.season?.team?.badge_label ?? 'AMATEUR')
    : (player.ranking != null ? `#${player.ranking} WORLD` : 'PLAYER')

  const identity = isAmateur
    ? [flagEmoji(player.country), membership?.season?.team?.name, membership?.season?.label]
        .filter(Boolean).join(' · ')
    : [flagEmoji(player.country), player.category === 'women' ? 'Women' : 'Men']
        .filter(Boolean).join(' · ')

  const sideLabel = player.side === 'drive' ? 'Drive' : player.side === 'backhand' ? 'Backhand' : '—'

  const boxes = isAmateur
    ? [
        { v: String(membership?.games_played ?? 0), l: 'GAMES', c: '#fff' },
        { v: `${membership?.wins ?? 0}–${membership?.losses ?? 0}`, l: 'RECORD', c: GREEN },
        { v: membership?.competition_points != null
            ? Number(membership.competition_points).toLocaleString('es-ES')
            : '—', l: 'POINTS', c: ORANGE },
        { v: sideLabel, l: 'SIDE', c: '#fff' },
      ]
    : [
        { v: player.win_rate != null ? `${Math.round(player.win_rate)}%` : '—', l: 'WIN RATE', c: GREEN },
        { v: player.titles != null ? String(player.titles) : '—', l: 'TITLES', c: ORANGE },
        { v: player.total_matches != null ? String(player.total_matches) : '—', l: 'MATCHES', c: '#fff' },
        { v: player.points != null ? player.points.toLocaleString('en-US') : '—', l: 'FIP PTS', c: ORANGE },
      ]

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', background: BG, display: 'flex',
        flexDirection: 'column', justifyContent: 'space-between', padding: 52,
      }}>
        <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" width={150} height={150}
              style={{ borderRadius: 75, objectFit: 'cover', border: `5px solid ${ORANGE}` }} />
          ) : (
            <div style={{
              width: 150, height: 150, borderRadius: 75,
              background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 62, color: '#000', border: `5px solid ${ORANGE}`,
            }}>
              {name[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'flex', background: GREEN, color: '#173404', fontSize: 20,
              padding: '5px 15px', marginBottom: 10, alignSelf: 'flex-start',
            }}>
              {badge}
            </div>
            <div style={{ fontSize: 58, color: '#fff', lineHeight: 1.05 }}>{name}</div>
            {identity && <div style={{ fontSize: 26, color: '#9A9A9A', marginTop: 8 }}>{identity}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          {boxes.map(b => (
            <div key={b.l} style={{
              flex: 1, background: CARD, padding: 20, display: 'flex',
              flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{ fontSize: 40, color: b.c }}>{b.v}</div>
              <div style={{ fontSize: 18, color: MUTED, marginTop: 6 }}>{b.l}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', fontSize: 20, color: '#6B6B6B', letterSpacing: 3 }}>
          PADELNACHOS.COM
        </div>
      </div>
    ),
    size,
  )
}
```

Satori não suporta todo o CSS: **todo elemento com mais de um filho precisa de `display: flex` explícito**, e é por isso que até os `<div>` de texto acima o declaram. Omitir isso é o erro mais comum aqui e produz um 500 com mensagem obscura.

Uma segunda armadilha, já encontrada neste repo ao construir `fetchTeamSeason`: **o PostgREST às vezes devolve um relacionamento "para um" como array**, não como objeto. Se o card do amador sair sem nome de equipe e sem temporada enquanto o banco tem os dois, é isso — o acesso `membership.season.team.name` encontrou um array. O tipo acima assume objeto, e o encadeamento opcional faz a linha de identidade degradar em vez de quebrar, mas confira o card do Gustavo no Step 3: ele tem equipe, então a linha **precisa** aparecer completa.

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit 2>&1 | grep -v "push-copy.test" | head -3 && npm run build 2>&1 | tail -3`
Expected: sem erros; build conclui.

- [ ] **Step 3: Ver as três imagens**

Suba o build numa porta livre (o operador usa a 3007):

```bash
(npx next start -p 3011 &) && sleep 8
curl -s -o /tmp/og-pro.png -w "pro:    %{http_code} %{size_download} bytes\n" \
  "http://localhost:3011/player/c95d2602-fb24-4b4b-9c60-40a0950a4eae/opengraph-image"
curl -s -o /tmp/og-am.png -w "amador: %{http_code} %{size_download} bytes\n" \
  "http://localhost:3011/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0/opengraph-image"
curl -s -o /tmp/og-none.png -w "sem foto/país: %{http_code} %{size_download} bytes\n" \
  "http://localhost:3011/player/c4787953-d54e-4b11-af50-da897164663a/opengraph-image"
pkill -f "next start -p 3011"
```

Expected: **200 nos três**, com tamanho maior que zero. O terceiro é o Eric Ortega — amador sem foto e sem país, que é o estado de 23 dos 24. Um 500 ali significa que a degradação não foi tratada.

Abra os três PNGs e confira o card visualmente.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/opengraph-image.tsx"
git commit -m "feat(share): player OG image, one frame branching on tier"
```

---

## Task 6: Verificação final

**Files:** nenhum — verificação.

- [ ] **Step 1: Build e start**

```bash
npm run build && npx next start -p 3007
```

- [ ] **Step 2: O metadata aponta pra imagem**

Run: `curl -s http://localhost:3007/es/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0 | grep -o 'og:image[^>]*' | head -2`
Expected: uma linha contendo `opengraph-image`. Vazio significa que a convenção do Next não pegou e o link compartilhado sai sem preview — que é o objetivo inteiro da feature.

- [ ] **Step 3: O botão**

Abra `/es/player/77ab6a3d-7484-46d2-b873-f90df0a4a1a0` no browser em viewport mobile. O ícone de compartilhar deve estar no hero, ao lado do Seguir. Clique: num browser com Web Share, a folha do sistema abre; sem ela, aparece o aviso "Enlace copiado". **Cancele a folha** e confirme que nenhuma mensagem de erro aparece.

Repita no perfil do Tapia.

- [ ] **Step 4: A URL compartilhada está certa**

Com o botão em modo clipboard, cole o que foi copiado. Em `/es/...` deve ser `https://padelnachos.com/es/player/<id>`; sem prefixo, `https://padelnachos.com/player/<id>`. **Nenhum dos dois pode ter `?tab=` ou `?season=`**, mesmo que você tenha trocado de aba antes de clicar.

- [ ] **Step 5: Console e rede**

`read_console_messages` e `read_network_requests`: sem erros, sem 4xx/5xx.

- [ ] **Step 6: Suíte**

Run: `npx vitest run src/lib/__tests__/ 2>&1 | grep -E "Tests|Test Files"`
Expected: verde.

- [ ] **Step 7: Screenshot**

Do hero com o botão e de um dos PNGs gerados, para o operador.
