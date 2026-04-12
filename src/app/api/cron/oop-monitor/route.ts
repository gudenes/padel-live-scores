// src/app/api/cron/oop-monitor/route.ts
// Monitors Order of Play changes for active tournaments.
// Checks each day's OOP for changes by comparing match count + content hash.
// Logs changes to ops_events for the ops dashboard to surface.
// Schedule: every 2 hours during tournament days

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { fetchOopDay } from '@/lib/fip-scraper'

export const runtime = 'nodejs'
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Active tournament configs ───────────────────────────────────
// Add tournaments here when they're active. Remove when done.
// In the future this could be auto-discovered from the DB.

interface MonitoredTournament {
  tournamentId: string
  matchscorerCode: string
  name: string
  totalDays: number
  startDate: string // "2026-04-11" — day 1 date
}

const MONITORED: MonitoredTournament[] = [
  {
    tournamentId: '7204f4ac-5ced-4b2f-b9c0-5fb81a497a90',
    matchscorerCode: 'FIP-2026-4401',
    name: 'NewGiza P2',
    totalDays: 8,
    startDate: '2026-04-11',
  },
]

function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 12)
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const results: { tournament: string; changes: string[] }[] = []

  for (const tournament of MONITORED) {
    const changes: string[] = []

    // Check each day
    for (let day = 1; day <= tournament.totalDays; day++) {
      try {
        const oopDay = await fetchOopDay(tournament.matchscorerCode, day)
        const matchCount = oopDay.matches.length

        if (matchCount === 0) continue // Empty day — skip

        // Build a content hash from player surnames + schedule labels
        const contentStr = oopDay.matches.map(m =>
          `${m.team1.map(p => p.surname).join('/')}vs${m.team2.map(p => p.surname).join('/')}@${m.scheduleLabel}`
        ).join('|')
        const contentHash = hashContent(contentStr)

        // Check against last known state in ops_events
        const eventKey = `oop-${tournament.matchscorerCode}-day${day}`
        const { data: lastEvent } = await supabase
          .from('ops_events')
          .select('meta')
          .eq('source', 'oop-monitor')
          .eq('status', 'ok')
          .filter('meta->>event_key', 'eq', eventKey)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const lastHash = (lastEvent?.meta as any)?.content_hash ?? null
        const lastMatchCount = (lastEvent?.meta as any)?.match_count ?? 0

        const isNew = !lastHash
        const isChanged = lastHash && lastHash !== contentHash
        const countChanged = lastMatchCount !== matchCount

        if (isNew || isChanged) {
          // Calculate the actual date for this day
          const dayDate = new Date(tournament.startDate)
          dayDate.setDate(dayDate.getDate() + day - 1)
          const dateStr = dayDate.toISOString().slice(0, 10)

          const changeType = isNew ? 'NEW' : 'UPDATED'
          const detail = countChanged
            ? `${changeType}: Day ${day} (${dateStr}) — ${matchCount} matches (was ${lastMatchCount})`
            : `${changeType}: Day ${day} (${dateStr}) — ${matchCount} matches (schedule changed)`

          changes.push(detail)

          // Log to ops_events
          await supabase.from('ops_events').insert({
            source: 'oop-monitor',
            status: 'ok',
            meta: {
              event_key: eventKey,
              tournament_id: tournament.tournamentId,
              tournament_name: tournament.name,
              day,
              date: dateStr,
              match_count: matchCount,
              content_hash: contentHash,
              change_type: changeType,
              previous_hash: lastHash,
              previous_count: lastMatchCount,
            },
          })
        }
      } catch (err) {
        console.error(`[OOP Monitor] Error checking ${tournament.name} day ${day}:`, err)
      }
    }

    if (changes.length > 0) {
      results.push({ tournament: tournament.name, changes })
      console.log(`[OOP Monitor] ${tournament.name}: ${changes.length} changes detected`)
    }
  }

  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0)

  return Response.json({
    monitored: MONITORED.length,
    totalChanges,
    results,
    message: totalChanges > 0
      ? `${totalChanges} OOP changes detected — review in ops dashboard Schedule tab`
      : 'No OOP changes detected',
  })
}
