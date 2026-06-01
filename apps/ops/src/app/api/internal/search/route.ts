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

    const [playersRes, tournamentsRes] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, country')
        .ilike('name', `%${q}%`)
        .order('ranking', { ascending: true, nullsFirst: false })
        .limit(5),
      supabase
        .from('tournaments')
        .select('id, name, level')
        .ilike('name', `%${q}%`)
        .order('starts_at', { ascending: false, nullsFirst: false })
        .limit(5),
    ])

    const hits: EntityHit[] = []

    for (const p of (playersRes.data ?? []) as Array<{ id: string; name: string | null; country: string | null }>) {
      hits.push({
        kind: 'player',
        id: p.id,
        label: p.name ?? '(unnamed)',
        sub: p.country ?? undefined,
        href: `/players/${p.id}`,
      })
    }

    for (const t of (tournamentsRes.data ?? []) as Array<{ id: string; name: string | null; level: string | null }>) {
      hits.push({
        kind: 'tournament',
        id: t.id,
        label: t.name ?? '(unnamed)',
        sub: t.level ?? undefined,
        href: `/odds/tournament/${t.id}`,
      })
    }

    return NextResponse.json({ hits })
  } catch {
    // Never surface an error into the palette — degrade to empty.
    return NextResponse.json({ hits: [] as EntityHit[] })
  }
}
