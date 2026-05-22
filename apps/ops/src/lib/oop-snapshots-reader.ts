// apps/ops/src/lib/oop-snapshots-reader.ts
//
// Lifted verbatim from src/lib/oop-snapshots-reader.ts in the main app.
// OopPlayer / OopMatch types are inlined here since we don't import
// the full fip-scraper module in the ops app.

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types (inlined from src/lib/fip-scraper.ts) ──────────────────────────────

export interface OopPlayer {
  initial: string       // "L."
  surname: string       // "Perez Parra"
  country: string | null  // "ESP" or null if flag missing in OOP HTML
  seed: number | null
  fullDisplay: string   // "L. Perez Parra"
}

export interface OopMatch {
  court: string
  scheduleLabel: string  // "Starting at 9:30 AM", "Followed by", "Not before 4:00 PM"
  team1: [OopPlayer, OopPlayer]
  team2: [OopPlayer, OopPlayer]
  category: 'men' | 'women' | null
  round: string | null   // "Q3", "Round of 32", etc.
  matchCode: string | null  // e.g. "MD019", "WQ004" from data-mid
}

// ── Internal snapshot row shape ───────────────────────────────────────────────

/** Subset of padelgod.oop_snapshots columns this module cares about. */
interface OopSnapshotRow {
  scrape_job_id: string
  tournament_id: string
  day_number: number
  category: 'men' | 'women'
  round_label: string | null
  court: string
  court_position: number | null
  scheduled_label: string | null
  team1_player1_name: string | null
  team1_player2_name: string | null
  team2_player1_name: string | null
  team2_player2_name: string | null
  match_widget_id: string | null
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired'
  captured_at: string
}

export interface ReadOopFromSnapshotsResult {
  day: number
  matches: OopMatch[]
  /** ISO timestamp of the scrape job these rows came from. Null if no snapshot exists. */
  capturedAt: string | null
  /** Number of rows in the latest snapshot (for telemetry / empty-day detection). */
  rowCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a short widget-format player name (e.g. "L. Perez Parra") into the
 * OopPlayer shape the Schedule Review route expects. Splits on whitespace:
 * first token is the initial, remaining tokens are the surname.
 */
function parsePlayerName(raw: string | null): OopPlayer {
  const txt = (raw ?? '').trim()
  if (!txt) {
    return { initial: '', surname: '', country: null, seed: null, fullDisplay: '' }
  }
  const firstSpace = txt.indexOf(' ')
  if (firstSpace === -1) {
    return {
      initial: '',
      surname: txt,
      country: null,
      seed: null,
      fullDisplay: txt,
    }
  }
  const initial = txt.slice(0, firstSpace).trim()
  const surname = txt.slice(firstSpace + 1).trim()
  return {
    initial,
    surname,
    country: null,
    seed: null,
    fullDisplay: txt,
  }
}

/**
 * Translate an internal round label from padelgod's OOP parser into the
 * format Schedule Review's fuzzy matcher expects.
 */
function normalizeRoundLabel(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the latest OOP snapshot for a tournament+day from
 * `padelgod.oop_snapshots` and adapt it into the OopDay shape the Schedule
 * Review route consumes.
 */
export async function readOopFromSnapshots(
  supabase: SupabaseClient,
  tournamentId: string,
  dayNumber: number,
): Promise<ReadOopFromSnapshotsResult> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'scrape_job_id, tournament_id, day_number, category, round_label, court, court_position, scheduled_label, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, match_widget_id, status, captured_at',
    )
    .eq('tournament_id', tournamentId)
    .eq('day_number', dayNumber)
    .order('captured_at', { ascending: false })

  if (error) {
    throw new Error(`oop_snapshots read failed: ${error.message}`)
  }

  const rows = (data ?? []) as OopSnapshotRow[]
  if (rows.length === 0) {
    return { day: dayNumber, matches: [], capturedAt: null, rowCount: 0 }
  }

  // Keep only rows from the latest scrape_job — a single scrape captures all
  // matches for that tournament+day atomically, so older jobs are superseded.
  const latestJobId = rows[0]!.scrape_job_id
  const latest = rows.filter((r) => r.scrape_job_id === latestJobId)

  // Sort by (court, court_position) for stable display order.
  latest.sort((a, b) => {
    if (a.court !== b.court) return a.court.localeCompare(b.court)
    const ap = a.court_position ?? Number.MAX_SAFE_INTEGER
    const bp = b.court_position ?? Number.MAX_SAFE_INTEGER
    return ap - bp
  })

  const matches: OopMatch[] = latest.map((r) => {
    const team1: [OopPlayer, OopPlayer] = [
      parsePlayerName(r.team1_player1_name),
      parsePlayerName(r.team1_player2_name),
    ]
    const team2: [OopPlayer, OopPlayer] = [
      parsePlayerName(r.team2_player1_name),
      parsePlayerName(r.team2_player2_name),
    ]
    return {
      court: r.court,
      scheduleLabel: r.scheduled_label ?? '',
      team1,
      team2,
      category: r.category,
      round: normalizeRoundLabel(r.round_label),
      matchCode: r.match_widget_id,
    }
  })

  return {
    day: dayNumber,
    matches,
    capturedAt: rows[0]!.captured_at,
    rowCount: latest.length,
  }
}

/**
 * Look up canonical `public.matches.id` values for a batch of Crionet widget
 * ids via `entity_external_ids` (source='crionet_widget'). The external_id
 * format is `{tournamentWidgetId}:{matchWidgetId}` (e.g. "FIP-2026-1701:MD017").
 *
 * Returns a Map from match widget id (e.g. "MD017") to match UUID for entries
 * found.
 */
export async function lookupMatchesByWidgetIds(
  supabase: SupabaseClient,
  tournamentWidgetId: string,
  matchWidgetIds: string[],
): Promise<Map<string, string>> {
  if (matchWidgetIds.length === 0) return new Map()

  const composites = matchWidgetIds.map(
    (id) => `${tournamentWidgetId}:${id}`,
  )

  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .in('external_id', composites)

  if (error) {
    throw new Error(`entity_external_ids widget-id lookup failed: ${error.message}`)
  }

  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ entity_id: string; external_id: string }>) {
    const colonIdx = row.external_id.indexOf(':')
    if (colonIdx < 0) continue
    const matchWidgetId = row.external_id.slice(colonIdx + 1)
    if (matchWidgetId) {
      out.set(matchWidgetId, row.entity_id)
    }
  }
  return out
}
