// apps/ops/src/app/api/internal/player/[id]/route.ts
// Full-profile player aggregator for the new /players/[id] page.
// Returns { player, equipment, recentMatches, earnings } in a single response
// so the profile page can render without orchestrating multiple fetches.
// Auth: Auth.js session with isOperator flag.
//
// Coexists with /api/internal/players (singular `player`, plural `players`)
// so the existing search/drawer endpoint keeps working. The list endpoint
// remains /api/internal/players + /api/internal/search-players.
//
// PATCH lets the new profile page persist edits inline. The handler enforces
// an allow-list so a malicious payload can't write to ranking, fip_id, or
// other source-of-truth columns owned by sync jobs.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import {
  buildAmateurCourtHistory,
  type AmateurCourtHistoryRow,
  type AmateurSlotMembershipRow,
  type AmateurSlotPartnersRow,
} from '@/lib/amateur-court-history'

// Columns selected from `players`. Mirrors the existing /api/internal/players
// GET PLUS public_id / slug / coaches (verified present in migrations
// 20260420000004 + 20260420000021).
const PLAYER_COLUMNS =
  'id, name, display_name, country, category, ranking, points, ranking_move, ' +
  'race_ranking, race_points, race_move, external_id, fip_id, avatar_url, photo_url, ' +
  'profile_url, side, height, birthdate, birthplace, hand, titles, finals, ' +
  // `equipment` (legacy jsonb) intentionally excluded — source of truth is
  // the `player_equipment` junction surfaced in the top-level `equipment` array.
  'semifinals, win_rate, total_matches, public_id, slug, coaches, tier, ' +
  'created_at, updated_at'

// Allow-list for PATCH. Anything outside this set is rejected with 400.
// Mirrors the inline-editable fields of the profile page; ranking, fip_id,
// padelapi_id, and the like are intentionally excluded because they are
// owned by the padelgod / padelapi sync workers.
const PATCHABLE_FIELDS = new Set([
  'name',
  'display_name',
  'country',
  'category',
  'side',
  'height',
  'birthdate',
  'birthplace',
  'hand',
  'avatar_url',
  'profile_url',
  'coaches',
])

// ── GET: full profile aggregate ──────────────────────────────────
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  const supabase = serviceClient()

  // 1. Player core. 404 fast if the row is missing.
  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('id', id)
    .single()

  if (playerErr && playerErr.code !== 'PGRST116') {
    return NextResponse.json({ error: playerErr.message }, { status: 500 })
  }
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }

  // 2. Equipment history — same JOIN shape as /api/internal/player-equipment GET
  const { data: equipment, error: equipmentErr } = await supabase
    .from('player_equipment')
    .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
    .eq('player_id', id)
    .order('started_at', { ascending: false })

  if (equipmentErr) {
    return NextResponse.json({ error: equipmentErr.message }, { status: 500 })
  }

  // 3. Recent matches — only meaningful for tour players. Amateurs never get
  //    rows in `matches` (their games live in the team model, see below), so
  //    skip this query entirely for them rather than run a guaranteed-empty
  //    OR scan. Professional players keep the exact same query + output.
  //
  // PostgREST's inferred type for `player` includes GenericStringError when
  // the column projection is partial (same as tournament-explorer's route);
  // we already checked `playerErr` above so this is a real row. Round-trip
  // through unknown to peel off the error variant for TS.
  const playerRow = player as unknown as { tier: string | null }
  const isAmateur = playerRow.tier === 'amateur'

  let recentMatches: unknown[] = []
  if (!isAmateur) {
    const { data, error: matchesErr } = await supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, court, winner_pair, ' +
          'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
          'tournament:tournaments(id, name, logo_url)',
      )
      .or(
        `pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},` +
          `pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`,
      )
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .limit(50)

    if (matchesErr) {
      return NextResponse.json({ error: matchesErr.message }, { status: 500 })
    }
    recentMatches = data ?? []
  }

  // 3b. Team court history — amateurs only. A team season has rounds
  // (`team_fixtures`), each round contested across five courts
  // (`team_fixture_slots`); this player's rows in `team_fixture_slot_players`
  // are their appearances. There is no opponent and no per-set score in this
  // model — only won/lost and how many sets it lasted — so the shaped rows
  // deliberately don't carry those fields.
  let teamCourtHistory: AmateurCourtHistoryRow[] = []
  if (isAmateur) {
    const { data: membershipRows, error: membershipErr } = await supabase
      .from('team_fixture_slot_players')
      .select(
        'slot_id, slot:team_fixture_slots(id, fixture_id, label, worth, result, sets, ' +
          'court_count, exact, partial, sort_order, ' +
          'fixture:team_fixtures(id, code, label, sort_order, complete, result, team_season_id, ' +
          'season:team_seasons(id, label, starts_on, team:teams(id, name))))',
      )
      .eq('player_id', id)

    if (membershipErr) {
      return NextResponse.json({ error: membershipErr.message }, { status: 500 })
    }

    const slotIds = [
      ...new Set(((membershipRows ?? []) as unknown as AmateurSlotMembershipRow[]).map((r) => r.slot_id)),
    ]

    let partnerRows: AmateurSlotPartnersRow[] = []
    if (slotIds.length > 0) {
      const { data: partners, error: partnersErr } = await supabase
        .from('team_fixture_slots')
        .select('id, players:team_fixture_slot_players(player_id, player:players(id, name))')
        .in('id', slotIds)

      if (partnersErr) {
        return NextResponse.json({ error: partnersErr.message }, { status: 500 })
      }
      partnerRows = (partners ?? []) as unknown as AmateurSlotPartnersRow[]
    }

    teamCourtHistory = buildAmateurCourtHistory(
      id,
      (membershipRows ?? []) as unknown as AmateurSlotMembershipRow[],
      partnerRows,
    )
  }

  // 4. Earnings — table is materialised by scripts/backfill-player-earnings.ts.
  //    No `year` column; the canonical date axis is earned_at TIMESTAMPTZ.
  const { data: earnings, error: earningsErr } = await supabase
    .from('player_tournament_earnings')
    .select(
      'id, tournament_id, category, round_eliminated, per_player_eur, source, earned_at, ' +
        'tournament:tournaments(name, level)',
    )
    .eq('player_id', id)
    .order('earned_at', { ascending: false })

  if (earningsErr) {
    return NextResponse.json({ error: earningsErr.message }, { status: 500 })
  }

  return NextResponse.json({
    player,
    equipment: equipment ?? [],
    recentMatches,
    teamCourtHistory,
    earnings: earnings ?? [],
  })
}

// ── PATCH: update allow-listed profile fields ────────────────────
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'Empty or invalid update payload' }, { status: 400 })
  }

  // Reject unknown fields up front — fail loudly rather than silently dropping.
  const unknownFields = Object.keys(body).filter((k) => !PATCHABLE_FIELDS.has(k))
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: `Unknown fields: ${unknownFields.join(', ')}` },
      { status: 400 },
    )
  }

  const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }
  const supabase = serviceClient()

  const { error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
