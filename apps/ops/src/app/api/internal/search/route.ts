// apps/ops/src/app/api/internal/search/route.ts
//
// Backing API for the ⌘K command palette's entity search. Best-effort:
// queries up to 5 players + 5 tournaments by name and returns a flat
// EntityHit[]. Never 500s the palette — any failure degrades to { hits: [] }.
//
// Auth: Auth.js session with isOperator check (matches the rest of
// /api/internal/* — see search-players/route.ts).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import type { EntityHit } from '@/lib/command-palette'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04-13T00:00:00Z" → "13 Apr 2026". Parses the date part of the ISO
 *  string directly so the label doesn't shift across the server timezone. */
function formatTournamentDate(startsAt: string | null): string | null {
  if (!startsAt) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startsAt)
  if (!m) return null
  const [, year, month, day] = m
  const monthLabel = MONTHS[Number(month) - 1]
  if (!monthLabel) return null
  return `${Number(day)} ${monthLabel} ${year}`
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ hits: [] as EntityHit[] })
  }

  try {
    const supabase = serviceClient()

    // Accent-insensitive search via the ops_global_search RPC (unaccents
    // both the query and the stored name) so "Ijui" matches "Ijuí". Returns
    // players + tournaments in one call; tournament rows carry starts_at so
    // we can show the date in the preview.
    const { data: rows } = await supabase.rpc('ops_global_search', { q })

    const hits: EntityHit[] = []

    for (const r of (rows ?? []) as Array<{
      kind: string
      id: string
      name: string | null
      sub: string | null
      starts_at: string | null
    }>) {
      if (r.kind === 'player') {
        hits.push({
          kind: 'player',
          id: r.id,
          label: r.name ?? '(unnamed)',
          sub: r.sub ?? undefined,
          href: `/players/${r.id}`,
        })
      } else if (r.kind === 'tournament') {
        // Combine level + start date so near-duplicate tournament names
        // (same event across seasons, or sibling tiers) are tellable apart.
        const sub = [r.sub, formatTournamentDate(r.starts_at)].filter(Boolean).join(' · ')
        hits.push({
          kind: 'tournament',
          id: r.id,
          label: r.name ?? '(unnamed)',
          sub: sub || undefined,
          href: `/tournament-explorer?tournament=${r.id}`,
        })
      }
    }

    return NextResponse.json({ hits })
  } catch {
    // Never surface an error into the palette — degrade to empty.
    return NextResponse.json({ hits: [] as EntityHit[] })
  }
}
