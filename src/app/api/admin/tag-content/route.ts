// src/app/api/admin/tag-content/route.ts
// Content tagging pipeline — scans articles and highlights for player/tournament mentions.
//
// GET /api/admin/tag-content              — tag all untagged content
// GET /api/admin/tag-content?force=true   — re-tag everything (clears existing tags first)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Name normalization ───────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Entity matching ──────────────────────────────────────────────────────

interface NameEntry {
  id: string
  normalized: string
  tokens: string[]
}

function buildIndex(items: Array<{ id: string; name: string }>): NameEntry[] {
  return items.map(item => {
    const n = normalize(item.name)
    return { id: item.id, normalized: n, tokens: n.split(' ').filter(t => t.length > 2) }
  })
}

function findMentions(text: string, index: NameEntry[], minTokens: number = 2): Set<string> {
  const normalizedText = normalize(text)
  const matches = new Set<string>()

  for (const entry of index) {
    // Skip entries with very short names (high false positive risk)
    if (entry.tokens.length < minTokens) continue

    // Check if full normalized name appears in text
    if (normalizedText.includes(entry.normalized)) {
      matches.add(entry.id)
      continue
    }

    // For longer names (3+ tokens), check if surname (last 2 tokens) appears
    if (entry.tokens.length >= 3) {
      const surname = entry.tokens.slice(-2).join(' ')
      if (surname.length >= 5 && normalizedText.includes(surname)) {
        matches.add(entry.id)
      }
    }
  }

  return matches
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get('force') === 'true'

  // 1. Load all players and tournaments
  const [playersRes, tournamentsRes] = await Promise.all([
    supabase.from('players').select('id, name'),
    supabase.from('tournaments').select('id, name'),
  ])

  const players = playersRes.data ?? []
  const tournaments = tournamentsRes.data ?? []
  const playerIndex = buildIndex(players)
  const tournamentIndex = buildIndex(tournaments)

  const stats = {
    articles: { processed: 0, playerTags: 0, tournamentTags: 0 },
    highlights: { processed: 0, playerTags: 0, tournamentTags: 0 },
  }

  // 2. Tag articles
  let articleQuery = supabase
    .from('articles')
    .select('id, title, snippet')
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(500)

  if (!force) {
    // Only tag articles not yet in junction tables
    const { data: tagged } = await supabase
      .from('article_players')
      .select('article_id')
    const taggedIds = new Set((tagged ?? []).map((r: any) => r.article_id))

    const { data: taggedT } = await supabase
      .from('article_tournaments')
      .select('article_id')
    for (const r of (taggedT ?? []) as any[]) taggedIds.add(r.article_id)

    // We'll filter after fetch since Supabase doesn't support NOT IN easily
    const { data: articles } = await articleQuery
    const untagged = (articles ?? []).filter((a: any) => !taggedIds.has(a.id))

    for (const article of untagged) {
      const text = `${article.title} ${article.snippet ?? ''}`
      const playerIds = findMentions(text, playerIndex)
      const tournamentIds = findMentions(text, tournamentIndex, 1)

      if (playerIds.size > 0) {
        const rows = [...playerIds].map(pid => ({ article_id: article.id, player_id: pid }))
        const { error } = await supabase.from('article_players').upsert(rows, { onConflict: 'article_id,player_id' })
        if (!error) stats.articles.playerTags += rows.length
      }

      if (tournamentIds.size > 0) {
        const rows = [...tournamentIds].map(tid => ({ article_id: article.id, tournament_id: tid }))
        const { error } = await supabase.from('article_tournaments').upsert(rows, { onConflict: 'article_id,tournament_id' })
        if (!error) stats.articles.tournamentTags += rows.length
      }

      stats.articles.processed++
    }
  } else {
    // Force mode: clear and re-tag all
    await supabase.from('article_players').delete().neq('article_id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('article_tournaments').delete().neq('article_id', '00000000-0000-0000-0000-000000000000')

    const { data: articles } = await articleQuery
    for (const article of (articles ?? []) as any[]) {
      const text = `${article.title} ${article.snippet ?? ''}`
      const playerIds = findMentions(text, playerIndex)
      const tournamentIds = findMentions(text, tournamentIndex, 1)

      if (playerIds.size > 0) {
        const rows = [...playerIds].map(pid => ({ article_id: article.id, player_id: pid }))
        await supabase.from('article_players').insert(rows)
        stats.articles.playerTags += rows.length
      }

      if (tournamentIds.size > 0) {
        const rows = [...tournamentIds].map(tid => ({ article_id: article.id, tournament_id: tid }))
        await supabase.from('article_tournaments').insert(rows)
        stats.articles.tournamentTags += rows.length
      }

      stats.articles.processed++
    }
  }

  // 3. Tag highlights
  const { data: highlights } = await supabase
    .from('highlights')
    .select('id, title, tournament_id')
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(500)

  if (force) {
    await supabase.from('highlight_players').delete().neq('highlight_id', '00000000-0000-0000-0000-000000000000')
  }

  const { data: hTagged } = await supabase
    .from('highlight_players')
    .select('highlight_id')
  const hTaggedIds = new Set((hTagged ?? []).map((r: any) => r.highlight_id))

  for (const h of (highlights ?? []) as any[]) {
    if (!force && hTaggedIds.has(h.id)) continue

    const playerIds = findMentions(h.title ?? '', playerIndex)

    if (playerIds.size > 0) {
      const rows = [...playerIds].map(pid => ({ highlight_id: h.id, player_id: pid }))
      const { error } = await supabase.from('highlight_players').upsert(rows, { onConflict: 'highlight_id,player_id' })
      if (!error) stats.highlights.playerTags += rows.length
    }

    stats.highlights.processed++
  }

  return NextResponse.json({
    ok: true,
    mode: force ? 'force' : 'incremental',
    entities: { players: players.length, tournaments: tournaments.length },
    ...stats,
  })
}
