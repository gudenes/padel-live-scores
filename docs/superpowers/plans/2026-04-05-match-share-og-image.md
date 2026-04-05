# Match Share + OG Image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a share button to the match detail page and generate dynamic OG images so shared links show rich match previews in WhatsApp/social media.

**Architecture:** Use Next.js file-convention `opengraph-image.tsx` for automatic OG image generation per match. Add `generateMetadata` via a layout wrapper for dynamic titles/descriptions. Share button uses `navigator.share()` with clipboard fallback.

**Tech Stack:** Next.js 16 `ImageResponse` (from `next/og`), Supabase server client, `navigator.share()` API

**Spec:** `docs/superpowers/specs/2026-04-05-match-share-og-image-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/match/[id]/opengraph-image.tsx` | Create | Dynamic OG image generation (1200x630) |
| `src/app/match/[id]/layout.tsx` | Create | Server-side `generateMetadata` for OG tags |
| `src/app/match/[id]/page.tsx` | Modify | Add share button to header |

---

### Task 1: Dynamic OG Image

**Files:**
- Create: `src/app/match/[id]/opengraph-image.tsx`

- [ ] **Step 1: Create the OG image route**

Create `src/app/match/[id]/opengraph-image.tsx`:

```tsx
import { ImageResponse } from 'next/og'
import { createServerClient } from '@/lib/supabase'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const runtime = 'nodejs'

// Revalidate every 60 seconds for live matches
export const revalidate = 60

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: match } = await supabase
    .from('matches')
    .select(`
      id, status, round, winner_pair, scheduled_at,
      pair1_player1:players!matches_pair1_player1_id_fkey(name, country, avatar_url),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, country, avatar_url),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, country, avatar_url),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, country, avatar_url),
      tournament:tournaments(name),
      sets(set_number, pair1_games, pair2_games)
    `)
    .eq('id', id)
    .single()

  if (!match) {
    return new ImageResponse(
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0A0A0A', color: '#fff', fontSize: 32 }}>
        Match not found
      </div>,
    )
  }

  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const p1Won = match.winner_pair === 1
  const p2Won = match.winner_pair === 2

  const lastName = (name: string | null) => {
    if (!name) return 'TBD'
    const parts = name.split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : name
  }

  const flagUrl = (country: string | null) =>
    country ? `https://flagcdn.com/w80/${country.toLowerCase()}.png` : null

  const sets = (match.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number)

  const p1Name = `${lastName(match.pair1_player1?.name)} / ${lastName(match.pair1_player2?.name)}`
  const p2Name = `${lastName(match.pair2_player1?.name)} / ${lastName(match.pair2_player2?.name)}`
  const tournament = (match.tournament as any)?.name ?? ''
  const round = match.round ?? ''

  const GREEN = '#7ED321'
  const MUTED = '#6B7280'
  const LIVE_RED = '#FF4655'

  return new ImageResponse(
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 50%, #0A0A0A 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '40px 60px',
    }}>
      {/* Logo text */}
      <div style={{ fontSize: 24, fontWeight: 900, color: GREEN, letterSpacing: 2, marginBottom: 8 }}>
        PADEL NACHOS
      </div>

      {/* LIVE badge */}
      {isLive && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,70,85,0.15)', border: '2px solid rgba(255,70,85,0.4)',
          borderRadius: 6, padding: '4px 14px', marginBottom: 16,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: LIVE_RED }} />
          <span style={{ fontSize: 16, fontWeight: 800, color: LIVE_RED, letterSpacing: 1 }}>LIVE</span>
        </div>
      )}

      {/* Pair 1 row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: 900, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
          {/* Flags */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {[match.pair1_player1, match.pair1_player2].map((p: any, i: number) => {
              const url = flagUrl(p?.country)
              return url ? (
                <img key={i} src={url} width={28} height={20} style={{ borderRadius: 2, objectFit: 'cover' }} />
              ) : <div key={i} style={{ width: 28, height: 20, background: '#333', borderRadius: 2 }} />
            })}
          </div>

          {/* Avatars */}
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {[match.pair1_player1, match.pair1_player2].map((p: any, i: number) => (
              <img
                key={i}
                src={p?.avatar_url || 'https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/default.png'}
                width={44} height={44}
                style={{
                  borderRadius: '50%', objectFit: 'cover',
                  border: `3px solid ${p1Won ? GREEN : '#333'}`,
                  marginLeft: i > 0 ? -8 : 0,
                }}
              />
            ))}
          </div>

          {/* Names */}
          <div style={{ fontSize: 22, fontWeight: 700, color: p1Won ? GREEN : (p2Won ? MUTED : '#fff') }}>
            {p1Name}
          </div>
        </div>

        {/* Scores */}
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          {sets.map((s: any) => (
            <span key={s.set_number} style={{
              fontSize: 28, fontWeight: 900, fontFamily: 'monospace',
              color: isLive ? LIVE_RED : (p1Won ? GREEN : (p2Won ? MUTED : '#fff')),
              minWidth: 30, textAlign: 'center',
            }}>
              {s.pair1_games}
            </span>
          ))}
        </div>
      </div>

      {/* VS divider */}
      <div style={{ fontSize: 14, color: MUTED, letterSpacing: 2, marginBottom: 8, fontWeight: 700 }}>VS</div>

      {/* Pair 2 row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: 900, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {[match.pair2_player1, match.pair2_player2].map((p: any, i: number) => {
              const url = flagUrl(p?.country)
              return url ? (
                <img key={i} src={url} width={28} height={20} style={{ borderRadius: 2, objectFit: 'cover' }} />
              ) : <div key={i} style={{ width: 28, height: 20, background: '#333', borderRadius: 2 }} />
            })}
          </div>
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {[match.pair2_player1, match.pair2_player2].map((p: any, i: number) => (
              <img
                key={i}
                src={p?.avatar_url || 'https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/default.png'}
                width={44} height={44}
                style={{
                  borderRadius: '50%', objectFit: 'cover',
                  border: `3px solid ${p2Won ? GREEN : '#333'}`,
                  marginLeft: i > 0 ? -8 : 0,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: p2Won ? GREEN : (p1Won ? MUTED : '#fff') }}>
            {p2Name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          {sets.map((s: any) => (
            <span key={s.set_number} style={{
              fontSize: 28, fontWeight: 900, fontFamily: 'monospace',
              color: isLive ? LIVE_RED : (p2Won ? GREEN : (p1Won ? MUTED : '#fff')),
              minWidth: 30, textAlign: 'center',
            }}>
              {s.pair2_games}
            </span>
          ))}
        </div>
      </div>

      {/* Tournament + round */}
      <div style={{ fontSize: 14, color: MUTED, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}>
        {tournament}{round ? ` · ${round}` : ''}
      </div>

      {/* Watermark */}
      <div style={{ position: 'absolute', bottom: 20, right: 40, fontSize: 12, color: 'rgba(126,211,33,0.3)', fontWeight: 800, letterSpacing: 1 }}>
        PADELNACHOS.COM
      </div>
    </div>,
  )
}
```

- [ ] **Step 2: Verify the OG image renders**

Open `http://localhost:3000/match/{MATCH_ID}/opengraph-image` in the browser (replace with a real match UUID from the database). Should see a 1200x630 PNG image with match data.

- [ ] **Step 3: Commit**

```bash
git add src/app/match/[id]/opengraph-image.tsx
git commit -m "feat: add dynamic OG image generation for match pages"
```

---

### Task 2: Match Page Metadata Layout

**Files:**
- Create: `src/app/match/[id]/layout.tsx`

- [ ] **Step 1: Create the layout with generateMetadata**

Create `src/app/match/[id]/layout.tsx`:

```tsx
import { createServerClient } from '@/lib/supabase'
import type { Metadata } from 'next'

function lastName(name: string | null): string {
  if (!name) return 'TBD'
  const parts = name.split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createServerClient()

  const { data: match } = await supabase
    .from('matches')
    .select(`
      id, status, round, winner_pair,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name),
      tournament:tournaments(name),
      sets(set_number, pair1_games, pair2_games)
    `)
    .eq('id', id)
    .single()

  if (!match) {
    return { title: 'Match | Padel Nachos' }
  }

  const p1 = `${lastName(match.pair1_player1?.name)}/${lastName(match.pair1_player2?.name)}`
  const p2 = `${lastName(match.pair2_player1?.name)}/${lastName(match.pair2_player2?.name)}`
  const tournament = (match.tournament as any)?.name ?? ''
  const round = match.round ?? ''
  const sets = (match.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number)
  const scoreText = sets.map((s: any) => `${s.pair1_games}-${s.pair2_games}`).join(', ')

  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const isLive = match.status === 'live'
  const p1Won = match.winner_pair === 1
  const winnerLabel = p1Won ? p1 : p2

  const title = isFinished && scoreText
    ? `${winnerLabel} won ${scoreText} — ${tournament} ${round}`
    : isLive
      ? `LIVE: ${p1} vs ${p2} — ${tournament}`
      : `${p1} vs ${p2} — ${tournament} ${round}`

  return {
    title,
    description: 'Follow live padel scores on PadelNachos',
    openGraph: {
      title,
      description: 'Follow live padel scores on PadelNachos',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
    },
  }
}

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children
}
```

- [ ] **Step 2: Verify metadata renders**

Open a match page in the browser. View page source (or use `curl -s http://localhost:3000/match/{ID} | grep 'og:'`) and confirm:
- `og:title` contains player names and score
- `og:image` points to the opengraph-image route

- [ ] **Step 3: Commit**

```bash
git add src/app/match/[id]/layout.tsx
git commit -m "feat: add generateMetadata for match pages (OG title, description)"
```

---

### Task 3: Share Button on Match Detail Page

**Files:**
- Modify: `src/app/match/[id]/page.tsx` (header area, lines 428-463)

- [ ] **Step 1: Add share button to the header**

In `src/app/match/[id]/page.tsx`, find the header `<div>` (around line 428-463). After the LIVE badge conditional (lines 457-462), add a share button:

```tsx
        {/* Share button */}
        <button
          onClick={async () => {
            const url = `https://padelnachos.com/match/${match.id}`
            const pair1 = `${match.pair1_player1?.name?.split(' ').pop() ?? 'TBD'}/${match.pair1_player2?.name?.split(' ').pop() ?? 'TBD'}`
            const pair2 = `${match.pair2_player1?.name?.split(' ').pop() ?? 'TBD'}/${match.pair2_player2?.name?.split(' ').pop() ?? 'TBD'}`
            const scores = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number).map(s => {
              const p = parseSetScore(s.set_score)
              return p ? `${p.p1}-${p.p2}` : `${s.pair1_games ?? 0}-${s.pair2_games ?? 0}`
            }).join(', ')
            const winLabel = match.winner_pair === 1 ? pair1 : match.winner_pair === 2 ? pair2 : null
            const title = `${pair1} vs ${pair2}`
            const text = isFinished && winLabel
              ? `${winLabel} won ${scores} — ${(match as any).tournament?.name ?? ''} ${match.round ?? ''}`
              : isLive
                ? `LIVE: ${pair1} vs ${pair2} ${scores} — ${(match as any).tournament?.name ?? ''}`
                : `${pair1} vs ${pair2} — ${(match as any).tournament?.name ?? ''} ${match.round ?? ''}`

            try {
              if (navigator.share) {
                await navigator.share({ title, text, url })
              } else {
                await navigator.clipboard.writeText(url)
                setShareToast(true)
                setTimeout(() => setShareToast(false), 2000)
              }
            } catch { /* user cancelled share */ }
          }}
          style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer', flexShrink: 0,
          }}
          aria-label="Share match"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
```

- [ ] **Step 2: Add shareToast state and toast UI**

Add state at the top of the component (near other `useState` declarations):

```tsx
const [shareToast, setShareToast] = useState(false)
```

Add the toast UI at the bottom of the JSX (before the closing `</div>` of the main container):

```tsx
      {/* Share toast */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: '#7ED321', color: '#000', padding: '8px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          Link copied!
        </div>
      )}
```

- [ ] **Step 3: Verify in browser**

- Open a match detail page
- Tap the share button (top-right, next to LIVE badge)
- On mobile: native share sheet opens
- On desktop: "Link copied!" toast appears

- [ ] **Step 4: Commit**

```bash
git add src/app/match/[id]/page.tsx
git commit -m "feat: add share button to match detail page header"
```

---

### Task 4: Verify End-to-End

- [ ] **Step 1: Test OG image directly**

Open in browser: `http://localhost:3000/match/{MATCH_ID}/opengraph-image`
Expected: 1200x630 PNG with player names, avatars, flags, scores, tournament name

- [ ] **Step 2: Test page metadata**

```bash
curl -s http://localhost:3000/match/{MATCH_ID} | grep -E 'og:|twitter:'
```
Expected: og:title with player names, og:image pointing to opengraph-image

- [ ] **Step 3: Test share button**

Open match detail page in browser, click share button.
Expected: clipboard copy + toast on desktop, native share on mobile

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from share feature testing"
```
