// src/app/api/ops/schedule-review/route.ts
// Fetches Order of Play from MatchScorer widget, matches against existing DB matches,
// and returns a preview for operator review. NEVER writes to DB — that's done via PATCH.
// Auth: reads ops_token cookie

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { fetchOopDay } from '@/lib/fip-scraper'
import type { OopMatch } from '@/lib/fip-scraper'
import { normalize, tokenSimilarity } from '@/lib/player-resolver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

// ── GET: Fetch OOP and match against DB ────────────────────────

interface ScheduleMatch {
  oopIndex: number
  court: string
  scheduleLabel: string
  category: 'men' | 'women' | null
  matchCode: string | null
  team1Display: string // "L. Perez Parra (ESP) / C. Rose (GBR)"
  team2Display: string
  // DB match link (if found)
  dbMatchId: string | null
  oopRound: string | null  // round from OOP header ("Q3", "Round of 32")
  dbMatchRound: string | null
  dbScheduledAt: string | null
  dbHasTime: boolean // true if scheduled_at already has a non-midnight time
  confidence: 'high' | 'medium' | 'low' | 'none'
  // What would change
  proposedScheduledAt: string | null
  proposedCourt: string | null
  proposedScheduleLabel: string | null
}

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

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

  // 1. Fetch OOP from widget
  const oopDay = await fetchOopDay(matchscorerCode, day)

  if (oopDay.matches.length === 0) {
    return Response.json({ matches: [], day, message: 'No matches found for this day' })
  }

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

  // 3. Get all DB matches for this tournament
  const { data: dbMatches } = await supabase
    .from('matches')
    .select(`
      id, round, court, scheduled_at, schedule_label, category, status,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
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
  const scheduleMatches: ScheduleMatch[] = oopDay.matches.map((oop, idx) => {
    const fmtPlayer = (p: { fullDisplay: string; country: string | null }) => p.country ? `${p.fullDisplay} (${p.country})` : p.fullDisplay
    const team1Display = `${fmtPlayer(oop.team1[0])} / ${fmtPlayer(oop.team1[1])}`
    const team2Display = `${fmtPlayer(oop.team2[0])} / ${fmtPlayer(oop.team2[1])}`

    // Try to match against DB matches by player name similarity
    let bestMatch: any = null
    let bestScore = 0

    for (const dbm of (dbMatches || []) as any[]) {
      // Compare OOP players against DB match players
      const dbNames = [
        dbm.pair1_player1?.name,
        dbm.pair1_player2?.name,
        dbm.pair2_player1?.name,
        dbm.pair2_player2?.name,
      ].filter(Boolean) as string[]

      if (dbNames.length < 2) continue

      // Check if OOP category matches DB category
      if (oop.category && dbm.category && oop.category !== dbm.category) continue

      // Score: count how many OOP player surnames match DB player names
      // OOP has abbreviated names ("H. Barbosa"), DB has full names ("Hugo Barbosa")
      // Strategy: check if OOP surname appears as a token in any DB player name
      const oopPlayers = [
        oop.team1[0], oop.team1[1],
        oop.team2[0], oop.team2[1],
      ]

      let matchCount = 0
      const usedDbNames = new Set<number>()
      for (const oopPlayer of oopPlayers) {
        const normSurname = normalize(oopPlayer.surname)
        // Split surname into tokens for multi-part surnames (e.g. "Perez Parra")
        const surTokens = normSurname.split(' ').filter(t => t.length > 1)
        if (surTokens.length === 0) continue

        for (let di = 0; di < dbNames.length; di++) {
          if (usedDbNames.has(di)) continue
          const normDb = normalize(dbNames[di])
          const dbTokens = normDb.split(' ').filter(t => t.length > 1)

          // Check if the OOP surname's last token matches any DB name token
          // (last token is the most distinctive part of the surname)
          const lastSurToken = surTokens[surTokens.length - 1]
          const surnameMatch = dbTokens.includes(lastSurToken)

          // Also check if OOP initial matches DB first name initial
          const initialMatch = oopPlayer.initial.length > 0 &&
            normDb.startsWith(oopPlayer.initial[0].toLowerCase())

          if (surnameMatch) {
            matchCount++
            usedDbNames.add(di)
            break
          }
        }
      }

      if (matchCount > bestScore) {
        bestScore = matchCount
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
        // "Starting at X:XX AM/PM" or "Not before X:XX PM" — parse exact time
        let hours = parseInt(timeMatch[1])
        const minutes = parseInt(timeMatch[2])
        const ampm = timeMatch[3].toUpperCase()
        if (ampm === 'PM' && hours < 12) hours += 12
        if (ampm === 'AM' && hours === 12) hours = 0
        proposedScheduledAt = localTimeToUtc(dayDate, hours, minutes)
        if (proposedScheduledAt) {
          lastTimePerCourt.set(oop.court, new Date(proposedScheduledAt))
        }
      } else if (/followed by/i.test(oop.scheduleLabel)) {
        // "Followed by" — estimate as previous match on same court + 90 minutes
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
      confidence,
      proposedScheduledAt,
      proposedCourt: oop.court,
      proposedScheduleLabel: oop.scheduleLabel,
    }
  })

  return Response.json({
    day,
    dayDate,
    timezone,
    totalOopMatches: oopDay.matches.length,
    matched: scheduleMatches.filter(m => m.dbMatchId).length,
    unmatched: scheduleMatches.filter(m => !m.dbMatchId).length,
    matches: scheduleMatches,
  })
}

// ── PATCH: Apply approved schedule changes ─────────────────────

export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { updates } = body as {
    updates: { matchId: string; scheduledAt: string; court: string | null; scheduleLabel: string | null }[]
  }

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return Response.json({ error: 'No updates provided' }, { status: 400 })
  }

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  for (const u of updates) {
    if (!u.matchId || !u.scheduledAt) {
      skipped++
      continue
    }

    // Safety: only update if match exists and scheduled_at doesn't already have a real time
    const { data: existing } = await supabase
      .from('matches')
      .select('id, scheduled_at')
      .eq('id', u.matchId)
      .single()

    if (!existing) {
      errors.push(`Match ${u.matchId.slice(0, 8)} not found`)
      continue
    }

    // Don't overwrite if already has a non-midnight time (unless it's the same date)
    if (existing.scheduled_at) {
      const d = new Date(existing.scheduled_at)
      if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) {
        skipped++
        continue // Already has a real time — don't overwrite
      }
    }

    const updateFields: Record<string, unknown> = {
      scheduled_at: u.scheduledAt,
      updated_at: new Date().toISOString(),
    }
    if (u.court) updateFields.court = u.court
    if (u.scheduleLabel) updateFields.schedule_label = u.scheduleLabel

    const { error } = await supabase
      .from('matches')
      .update(updateFields)
      .eq('id', u.matchId)

    if (error) {
      errors.push(`${u.matchId.slice(0, 8)}: ${error.message}`)
    } else {
      updated++
    }
  }

  return Response.json({ updated, skipped, errors })
}
