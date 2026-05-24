// apps/ops/src/app/api/internal/schedule-review/route.ts
// Fetches Order of Play from padelgod.oop_snapshots, matches against existing
// DB matches, and returns a preview for operator review.
// PATCH writes to public.matches (scheduled_at / court / schedule_label /
// player FKs). Operationally critical — write path is guarded by Option A
// safety checks (see PATCH handler).
// Auth: Auth.js session with isOperator check (both GET and PATCH).

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import type { OopMatch } from '@/lib/oop-snapshots-reader'
import {
  readOopFromSnapshots,
  lookupMatchesByWidgetIds,
} from '@/lib/oop-snapshots-reader'
import { resolveOopPlayerToId } from '@/lib/oop-player-lookup'

/**
 * Per-slot player payload powering the shared PlayerLink component in the
 * Schedule Review panel. `id` is null when the slot hasn't been resolved
 * back to a `public.players` row yet (PlayerLink renders plain italic text,
 * status = "unresolved"). When `id` is set, the enrichment fields determine
 * whether PlayerLink shows "thin" or "enriched".
 *
 * `name` is always the OOP-side display string ("L. Perez Parra") — we
 * don't overwrite with the resolved player's canonical name because the
 * operator is reviewing exactly that mismatch.
 *
 * For schedule review specifically, a slot resolves through either:
 *   (a) `bestMatch.pair{1,2}_player{1,2}_id` — DB FK already present, or
 *   (b) `resolvedNewId` — OOP proposed a player for a currently-null slot.
 * Either path counts as "resolved" for link/enrichment purposes; PlayerLink
 * itself doesn't care which.
 */
interface ExplorerPlayer {
  id: string | null
  name: string
  avatar_url: string | null
  ranking: number | null
  padelapi_id: string | null
  fip_id: string | null
}

// ── Name normalization (inlined from src/lib/player-resolver.ts) ─────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── GET: Fetch OOP and match against DB ────────────────────────

// Player slot positions in public.matches. Keeping the DB column names
// literal so the PATCH writer can compose updates without translation.
type PlayerSlotKey =
  | 'pair1_player1_id'
  | 'pair1_player2_id'
  | 'pair2_player1_id'
  | 'pair2_player2_id'

/**
 * Per-slot detail surfaced to the UI so operators can see WHICH players are
 * TBD and whether the OOP can fill them. `currentId` is the FK value in the
 * DB today (null = TBD). `oopName` is the abbreviated name from the widget
 * (may itself be null if the widget row is incomplete). `resolvedNewId` is
 * only set when oopName parsed, category matched, and exactly one DB player
 * was found — otherwise null (ambiguous or missing).
 *
 * Option A safety: `resolvedNewId` is only meaningful when `currentId === null`.
 * When `currentId` is populated, we never propose an overwrite — the UI treats
 * that slot as sealed.
 */
interface PlayerSlotDiff {
  slot: PlayerSlotKey
  currentId: string | null
  oopName: string | null
  resolvedNewId: string | null
  /** Country code as captured from the OOP widget (e.g. "ESP") — used for the
   *  small `(ESP)` annotation rendered next to PlayerLink. Null when the
   *  widget row didn't carry a flag. */
  country: string | null
  /** Per-slot enriched payload powering PlayerLink. Falls back to a name-only
   *  shape (id=null, all enrichment null) when no DB row is linked yet. Null
   *  when the OOP widget didn't have a name at all for this slot. */
  player: ExplorerPlayer | null
}

interface ScheduleMatch {
  oopIndex: number
  court: string
  scheduleLabel: string
  category: 'men' | 'women' | null
  matchCode: string | null
  team1Display: string // "L. Perez Parra / C. Rose" (country codes dropped in PR #13)
  team2Display: string
  // DB match link (if found)
  dbMatchId: string | null
  oopRound: string | null  // round from OOP header ("Q3", "Round of 32")
  dbMatchRound: string | null
  dbScheduledAt: string | null
  dbHasTime: boolean // true if scheduled_at already has a non-midnight time
  dbCourt: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  // Per-field diff flags — UI uses these to render chips ("↻ TIME" / "↻ COURT"
  // / "↻ PLAYERS") and to decide whether the row is selectable.
  needsTimeChange: boolean
  needsCourtChange: boolean
  needsPlayersChange: boolean
  /**
   * Four slots (pair1 players + pair2 players). Only populated when this
   * OOP row is linked to a DB match (dbMatchId !== null).
   */
  playerSlots: PlayerSlotDiff[]
  // What would change
  proposedScheduledAt: string | null
  proposedCourt: string | null
  proposedScheduleLabel: string | null
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  const matchscorerCode = url.searchParams.get('code') // e.g. "FIP-2026-4401"
  const dayStr = url.searchParams.get('day')
  const dateParam = url.searchParams.get('date') // e.g. "2026-04-13" — operator provides the actual date

  if (!tournamentId || !matchscorerCode || !dayStr) {
    return Response.json({ error: 'Required params: tournament_id, code, day' }, { status: 400 })
  }

  const day = parseInt(dayStr)
  if (isNaN(day) || day < 1 || day > 10) {
    return Response.json({ error: 'day must be 1-10' }, { status: 400 })
  }

  // 1. Read OOP from padelgod.oop_snapshots (populated hourly by padelgod's
  //    oop-fetcher worker). Replaces the legacy fetchOopDay() direct scrape
  //    which had a brittle court-name regex. One parser of record now.
  const oopDay = await readOopFromSnapshots(supabase, tournamentId, day)

  if (oopDay.matches.length === 0) {
    return Response.json({
      matches: [],
      day,
      capturedAt: oopDay.capturedAt,
      source: 'padelgod.oop_snapshots',
      message: oopDay.capturedAt
        ? 'No matches found for this day in latest snapshot'
        : 'No snapshot yet — padelgod oop-fetcher may not have run for this tournament',
    })
  }

  // Exact match-widget-id lookup — when present, lets us skip fuzzy name
  // matching entirely and get confidence='high' automatically.
  const widgetIdsPresent = oopDay.matches
    .map((m) => m.matchCode)
    .filter((c): c is string => !!c)
  const widgetIdToMatchId = await lookupMatchesByWidgetIds(
    supabase,
    matchscorerCode,
    widgetIdsPresent,
  )

  // 2. Get tournament timezone
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('timezone, starts_at')
    .eq('id', tournamentId)
    .single()

  const timezone = tournament?.timezone || 'UTC'

  // Date for this day — operator-provided takes priority, otherwise calculate from starts_at
  let dayDate: string | null = dateParam || null
  if (!dayDate && tournament?.starts_at) {
    const d = new Date(tournament.starts_at)
    d.setDate(d.getDate() + day - 1)
    dayDate = d.toISOString().slice(0, 10)
  }

  // 3. Get all DB matches for this tournament. We select both the player
  //    name (for fuzzy-match display + legacy logic) AND the raw FK id
  //    (for per-slot diff + Option A safety guard in PATCH).
  //    Enrichment fields (avatar_url, ranking, padelapi_id, fip_id) ride
  //    along on the embedded player rows so we can build ExplorerPlayer
  //    payloads for PlayerLink without a second round trip.
  const { data: dbMatches } = await supabase
    .from('matches')
    .select(`
      id, round, court, scheduled_at, schedule_label, category, status,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name, avatar_url, ranking, padelapi_id, fip_id),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name, avatar_url, ranking, padelapi_id, fip_id),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name, avatar_url, ranking, padelapi_id, fip_id),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name, avatar_url, ranking, padelapi_id, fip_id)
    `)
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live', 'finished'])

  // Helper: convert local time string to UTC ISO using tournament timezone
  function localTimeToUtc(dateStr: string, hours: number, minutes: number): string | null {
    try {
      const localStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
      const probe = new Date(localStr + 'Z')
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit', hour12: false,
      })
      const parts = formatter.formatToParts(probe)
      const localHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
      const utcHour = probe.getUTCHours()
      const offsetHours = localHour - utcHour
      const utcDate = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`)
      utcDate.setHours(utcDate.getHours() - offsetHours)
      return utcDate.toISOString()
    } catch {
      return null
    }
  }

  // Track last proposed time per court for "Followed by" estimation (+90 min)
  const lastTimePerCourt = new Map<string, Date>()

  // 4. Match OOP entries against DB matches
  const scheduleMatches: ScheduleMatch[] = await Promise.all(oopDay.matches.map(async (oop, idx): Promise<ScheduleMatch> => {
    const fmtPlayer = (p: { fullDisplay: string; country: string | null }) => p.country ? `${p.fullDisplay} (${p.country})` : p.fullDisplay
    const team1Display = `${fmtPlayer(oop.team1[0])} / ${fmtPlayer(oop.team1[1])}`
    const team2Display = `${fmtPlayer(oop.team2[0])} / ${fmtPlayer(oop.team2[1])}`

    // Exact match path — if the OOP row has a widget id that's already linked
    // in entity_external_ids, we know the DB match without any fuzzy logic.
    let bestMatch: any = null
    let bestScore = 0
    let bestRoundPriority = 0
    const exactMatchId = oop.matchCode
      ? widgetIdToMatchId.get(oop.matchCode) ?? null
      : null

    if (exactMatchId) {
      bestMatch = (dbMatches || []).find((m: any) => m.id === exactMatchId) ?? null
      if (bestMatch) {
        // Bypass fuzzy scoring — exact widget-id linkage is the strongest
        // signal available.
        bestScore = 4
        bestRoundPriority = 1
      }
    }

    // Fall back to fuzzy name matching when no exact widget-id link exists
    for (const dbm of (dbMatches || []) as any[]) {
      if (exactMatchId) break // already resolved exactly
      const dbNames = [
        dbm.pair1_player1?.name,
        dbm.pair1_player2?.name,
        dbm.pair2_player1?.name,
        dbm.pair2_player2?.name,
      ].filter(Boolean) as string[]

      if (dbNames.length < 2) continue

      if (oop.category && dbm.category && oop.category !== dbm.category) continue

      const oopPlayers = [
        oop.team1[0], oop.team1[1],
        oop.team2[0], oop.team2[1],
      ]

      let matchCount = 0
      const usedDbNames = new Set<number>()
      for (const oopPlayer of oopPlayers) {
        const normSurname = normalize(oopPlayer.surname)
        const surTokens = normSurname.split(' ').filter(t => t.length > 1)
        if (surTokens.length === 0) continue

        for (let di = 0; di < dbNames.length; di++) {
          if (usedDbNames.has(di)) continue
          const normDb = normalize(dbNames[di])
          const dbTokens = normDb.split(' ').filter(t => t.length > 1)

          const lastSurToken = surTokens[surTokens.length - 1]
          const surnameMatch = dbTokens.includes(lastSurToken!)

          if (surnameMatch) {
            matchCount++
            usedDbNames.add(di)
            break
          }
        }
      }

      let roundPriority = 0
      if (oop.round && dbm.round) {
        const normOopRound = oop.round.toLowerCase().replace(/s$/, '')
        const normDbRound = (dbm.round as string).toLowerCase().replace(/s$/, '')
        if (normDbRound.includes(normOopRound) || normOopRound.includes(normDbRound)) {
          roundPriority = 1
        }
      }

      const isBetter =
        matchCount > bestScore ||
        (matchCount === bestScore && roundPriority > bestRoundPriority)

      if (isBetter) {
        bestScore = matchCount
        bestRoundPriority = roundPriority
        bestMatch = dbm
      }
    }

    const confidence: 'high' | 'medium' | 'low' | 'none' =
      bestScore >= 4 ? 'high' :
      bestScore >= 3 ? 'medium' :
      bestScore >= 2 ? 'low' : 'none'

    // Build proposed scheduled_at from OOP time + day date + timezone
    let proposedScheduledAt: string | null = null
    if (dayDate) {
      const timeMatch = oop.scheduleLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]!)
        const minutes = parseInt(timeMatch[2]!)
        const ampm = timeMatch[3]!.toUpperCase()
        if (ampm === 'PM' && hours < 12) hours += 12
        if (ampm === 'AM' && hours === 12) hours = 0
        proposedScheduledAt = localTimeToUtc(dayDate, hours, minutes)
        if (proposedScheduledAt) {
          lastTimePerCourt.set(oop.court, new Date(proposedScheduledAt))
        }
      } else if (/followed by/i.test(oop.scheduleLabel)) {
        const lastTime = lastTimePerCourt.get(oop.court)
        if (lastTime) {
          const estimated = new Date(lastTime.getTime() + 90 * 60 * 1000)
          proposedScheduledAt = estimated.toISOString()
          lastTimePerCourt.set(oop.court, estimated)
        }
      }
    }

    const dbHasTime = bestMatch?.scheduled_at
      ? (() => { const d = new Date(bestMatch.scheduled_at); return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 })()
      : false

    // ── Per-slot player diff ───────────────────────────────────────────
    // Each slot carries both the legacy diff fields (currentId / oopName /
    // resolvedNewId driving the apply UX) AND a nested ExplorerPlayer
    // payload that the shared PlayerLink component reads in the UI.
    //
    // `currentId`-based enrichment is taken from the embedded join on
    // dbMatches (avatar_url / ranking / padelapi_id / fip_id). For slots
    // resolved only via `resolvedNewId`, enrichment is filled in by a
    // batch fetch AFTER this loop so we don't issue per-slot HTTP calls.
    const oopSlotPlayers: Record<PlayerSlotKey, { name: string | null; country: string | null }> = {
      pair1_player1_id: { name: oop.team1[0]?.fullDisplay || null, country: oop.team1[0]?.country ?? null },
      pair1_player2_id: { name: oop.team1[1]?.fullDisplay || null, country: oop.team1[1]?.country ?? null },
      pair2_player1_id: { name: oop.team2[0]?.fullDisplay || null, country: oop.team2[0]?.country ?? null },
      pair2_player2_id: { name: oop.team2[1]?.fullDisplay || null, country: oop.team2[1]?.country ?? null },
    }
    const dbSlotIds: Record<PlayerSlotKey, string | null> = {
      pair1_player1_id: (bestMatch?.pair1_player1_id ?? null) as string | null,
      pair1_player2_id: (bestMatch?.pair1_player2_id ?? null) as string | null,
      pair2_player1_id: (bestMatch?.pair2_player1_id ?? null) as string | null,
      pair2_player2_id: (bestMatch?.pair2_player2_id ?? null) as string | null,
    }
    // Embedded player rows from the dbMatches join (one per slot). Used to
    // populate the ExplorerPlayer enrichment for slots whose `currentId`
    // is non-null.
    const dbSlotPlayers: Record<PlayerSlotKey, ExplorerPlayer | null> = {
      pair1_player1_id: (bestMatch?.pair1_player1 ?? null) as ExplorerPlayer | null,
      pair1_player2_id: (bestMatch?.pair1_player2 ?? null) as ExplorerPlayer | null,
      pair2_player1_id: (bestMatch?.pair2_player1 ?? null) as ExplorerPlayer | null,
      pair2_player2_id: (bestMatch?.pair2_player2 ?? null) as ExplorerPlayer | null,
    }
    const SLOT_KEYS: PlayerSlotKey[] = [
      'pair1_player1_id',
      'pair1_player2_id',
      'pair2_player1_id',
      'pair2_player2_id',
    ]
    const playerSlots: PlayerSlotDiff[] = await Promise.all(
      SLOT_KEYS.map(async (slot): Promise<PlayerSlotDiff> => {
        const currentId = bestMatch ? dbSlotIds[slot] : null
        const { name: oopName, country } = oopSlotPlayers[slot]
        let resolvedNewId: string | null = null
        if (bestMatch && currentId === null && oopName && oop.category) {
          resolvedNewId = await resolveOopPlayerToId(
            supabase,
            oopName,
            oop.category,
          )
        }
        // Build the ExplorerPlayer slot. Display name is always the OOP-side
        // string (canonical for this surface — operator is reviewing the
        // schedule change). Enrichment comes from the embedded player join
        // when `currentId` is set; otherwise it's filled in by the post-pass
        // batch fetch keyed off `resolvedNewId`.
        let player: ExplorerPlayer | null = null
        if (oopName) {
          const enriched = currentId ? dbSlotPlayers[slot] : null
          player = {
            id: currentId ?? resolvedNewId ?? null,
            name: oopName,
            avatar_url: enriched?.avatar_url ?? null,
            ranking: enriched?.ranking ?? null,
            padelapi_id: enriched?.padelapi_id ?? null,
            fip_id: enriched?.fip_id ?? null,
          }
        }
        return { slot, currentId, oopName, resolvedNewId, country, player }
      }),
    )

    // ── Per-field diff flags ────────────────────────────────────────────
    const needsTimeChange = !!(
      bestMatch &&
      proposedScheduledAt &&
      bestMatch.scheduled_at !== proposedScheduledAt
    )
    const oopCourtNorm = oop.court.trim().toLowerCase()
    const dbCourtNorm = (bestMatch?.court ?? '').trim().toLowerCase()
    const needsCourtChange = !!(
      bestMatch &&
      oopCourtNorm &&
      oopCourtNorm !== dbCourtNorm
    )
    const needsPlayersChange = playerSlots.some(
      (s) => s.currentId === null && s.resolvedNewId !== null,
    )

    return {
      oopIndex: idx,
      court: oop.court,
      scheduleLabel: oop.scheduleLabel,
      category: oop.category,
      matchCode: oop.matchCode,
      team1Display,
      team2Display,
      oopRound: oop.round,
      dbMatchId: confidence !== 'none' && bestMatch ? bestMatch.id : null,
      dbMatchRound: bestMatch?.round ?? null,
      dbScheduledAt: bestMatch?.scheduled_at ?? null,
      dbHasTime,
      dbCourt: bestMatch?.court ?? null,
      confidence,
      needsTimeChange,
      needsCourtChange,
      needsPlayersChange,
      playerSlots,
      proposedScheduledAt,
      proposedCourt: oop.court,
      proposedScheduleLabel: oop.scheduleLabel,
    }
  }))

  // ── Post-pass: enrich `resolvedNewId` slots ─────────────────────────
  //
  // Slots that resolved via `resolveOopPlayerToId` only carry a UUID at
  // this point — no avatar / ranking / padelapi_id. Batch-fetch the
  // matching player rows in one round-trip and mutate the slot's
  // `player` field so PlayerLink shows "enriched" instead of "thin"
  // when the resolved row actually has enrichment.
  const resolvedNewIds = new Set<string>()
  for (const m of scheduleMatches) {
    for (const s of m.playerSlots) {
      if (s.resolvedNewId && s.currentId === null) {
        resolvedNewIds.add(s.resolvedNewId)
      }
    }
  }
  if (resolvedNewIds.size > 0) {
    const { data: enrichRows } = await supabase
      .from('players')
      .select('id, avatar_url, ranking, padelapi_id, fip_id')
      .in('id', [...resolvedNewIds])
    const enrichById = new Map<
      string,
      { avatar_url: string | null; ranking: number | null; padelapi_id: string | null; fip_id: string | null }
    >()
    for (const p of (enrichRows ?? []) as Array<{
      id: string
      avatar_url: string | null
      ranking: number | null
      padelapi_id: string | null
      fip_id: string | null
    }>) {
      enrichById.set(p.id, {
        avatar_url: p.avatar_url,
        ranking: p.ranking,
        padelapi_id: p.padelapi_id,
        fip_id: p.fip_id,
      })
    }
    for (const m of scheduleMatches) {
      for (const s of m.playerSlots) {
        if (s.player && s.resolvedNewId && s.currentId === null) {
          const e = enrichById.get(s.resolvedNewId)
          if (e) {
            s.player.avatar_url = e.avatar_url
            s.player.ranking = e.ranking
            s.player.padelapi_id = e.padelapi_id
            s.player.fip_id = e.fip_id
          }
        }
      }
    }
  }

  return Response.json({
    day,
    dayDate,
    timezone,
    totalOopMatches: oopDay.matches.length,
    matched: scheduleMatches.filter(m => m.dbMatchId).length,
    unmatched: scheduleMatches.filter(m => !m.dbMatchId).length,
    needsUpdateCount: scheduleMatches.filter(
      m => m.dbMatchId && (m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange),
    ).length,
    matches: scheduleMatches,
    source: 'padelgod.oop_snapshots',
    capturedAt: oopDay.capturedAt,
    exactMatchCount: scheduleMatches.filter(m => m.matchCode && widgetIdToMatchId.has(m.matchCode!)).length,
  })
}

// ── PATCH: Apply approved schedule changes ─────────────────────
//
// Payload shape (per-field granular):
//   {
//     updates: [
//       {
//         matchId: string,
//         scheduledAt?: string,       // ISO, only written when present
//         court?: string,             // only written when present
//         scheduleLabel?: string,     // only written when present
//         playerUpdates?: Partial<Record<PlayerSlotKey, string>>
//       }
//     ]
//   }
//
// Per-field semantics:
//  - scheduledAt/court/scheduleLabel: if present in payload, written.
//  - playerUpdates: per-slot map. Writes ONLY when the current DB value is
//    NULL — Option A safety. Never overwrites populated player FKs.

type PlayerSlotKeyInternal =
  | 'pair1_player1_id'
  | 'pair1_player2_id'
  | 'pair2_player1_id'
  | 'pair2_player2_id'

interface UpdateRequest {
  matchId: string
  scheduledAt?: string
  court?: string
  scheduleLabel?: string
  playerUpdates?: Partial<Record<PlayerSlotKeyInternal, string>>
}

const PLAYER_SLOT_KEYS: readonly PlayerSlotKeyInternal[] = [
  'pair1_player1_id',
  'pair1_player2_id',
  'pair2_player1_id',
  'pair2_player2_id',
]

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const body = await request.json()
  const { updates } = body as { updates: UpdateRequest[] }

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return Response.json({ error: 'No updates provided' }, { status: 400 })
  }

  let updated = 0
  let skipped = 0
  let playerFieldsFilled = 0
  const errors: string[] = []

  for (const u of updates) {
    if (!u.matchId) {
      skipped++
      continue
    }

    // Build the update payload from whatever fields are present.
    const scheduleFields: Record<string, unknown> = {}
    if (u.scheduledAt) scheduleFields.scheduled_at = u.scheduledAt
    if (u.court) scheduleFields.court = u.court
    if (u.scheduleLabel) scheduleFields.schedule_label = u.scheduleLabel

    const playerUpdates = u.playerUpdates ?? {}
    const playerSlotsRequested = PLAYER_SLOT_KEYS.filter(
      (k) => typeof playerUpdates[k] === 'string' && playerUpdates[k]!.length > 0,
    )

    if (
      Object.keys(scheduleFields).length === 0 &&
      playerSlotsRequested.length === 0
    ) {
      skipped++
      continue
    }

    // ── Option A safety for player writes ───────────────────────────────
    // Re-read current FK values. Only include slots that are currently NULL
    // in the write — never overwrite populated player FKs.
    let playerFields: Record<string, unknown> = {}
    if (playerSlotsRequested.length > 0) {
      const { data: existing, error: readErr } = await supabase
        .from('matches')
        .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
        .eq('id', u.matchId)
        .single()

      if (readErr || !existing) {
        errors.push(
          `${u.matchId.slice(0, 8)}: pre-write read failed — ${readErr?.message ?? 'no row'}`,
        )
        continue
      }

      for (const slot of playerSlotsRequested) {
        const currentValue = (existing as Record<string, string | null>)[slot]
        if (currentValue === null) {
          playerFields[slot] = playerUpdates[slot]!
          playerFieldsFilled++
        }
        // If currentValue is not null, silently drop — Option A never overwrites.
      }
    }

    const fullUpdate: Record<string, unknown> = {
      ...scheduleFields,
      ...playerFields,
    }

    // Still possible to end with an empty update if all player slots were
    // already filled and no schedule fields were requested — skip cleanly.
    if (Object.keys(fullUpdate).length === 0) {
      skipped++
      continue
    }
    fullUpdate.updated_at = new Date().toISOString()

    const { error } = await supabase
      .from('matches')
      .update(fullUpdate)
      .eq('id', u.matchId)

    if (error) {
      errors.push(`${u.matchId.slice(0, 8)}: ${error.message}`)
    } else {
      updated++
    }
  }

  return Response.json({ updated, skipped, playerFieldsFilled, errors })
}
