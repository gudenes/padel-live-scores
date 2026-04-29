// One-shot apply of the new fip-oop-writer Pass B (scheduled_at gap-fill)
// for FIP-only tournaments whose matches have NULL scheduled_at right now.
//
// Used the day this PR ships, before the next padelgod cron tick, so the
// Singapore B3 Final tomorrow shows up in the public matches list right
// away rather than waiting for the :52 cron at Railway.
//
// Idempotent: only writes when scheduled_at IS NULL. Safe to re-run.
//
// Usage:
//   npx tsx scripts/apply-fip-oop-schedule-now.ts [--dry-run] [--tournament <uuid>]

import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const TIDX = args.indexOf('--tournament')
const TOURNAMENT_FILTER = TIDX >= 0 ? args[TIDX + 1] : null

const FOLLOWED_BY_GAP_MINUTES = 90
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/i

const COUNTRY_TIMEZONES: Record<string, string> = {
  ES: 'Europe/Madrid', FR: 'Europe/Paris', IT: 'Europe/Rome', DE: 'Europe/Berlin',
  PT: 'Europe/Lisbon', GB: 'Europe/London', US: 'America/New_York',
  MX: 'America/Mexico_City', AR: 'America/Argentina/Buenos_Aires',
  BR: 'America/Sao_Paulo', SA: 'Asia/Riyadh', AE: 'Asia/Dubai', QA: 'Asia/Qatar',
  HK: 'Asia/Hong_Kong', SG: 'Asia/Singapore', JP: 'Asia/Tokyo',
  AU: 'Australia/Sydney', ZA: 'Africa/Johannesburg', MA: 'Africa/Casablanca',
  EG: 'Africa/Cairo', SE: 'Europe/Stockholm', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', AT: 'Europe/Vienna', CH: 'Europe/Zurich',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', RO: 'Europe/Bucharest',
  GR: 'Europe/Athens', TR: 'Europe/Istanbul', IL: 'Asia/Jerusalem',
  KZ: 'Asia/Almaty', UZ: 'Asia/Tashkent', KG: 'Asia/Bishkek',
  CL: 'America/Santiago', CO: 'America/Bogota', PY: 'America/Asuncion',
  PE: 'America/Lima', EC: 'America/Guayaquil', UY: 'America/Montevideo',
  CN: 'Asia/Shanghai', IN: 'Asia/Kolkata', TH: 'Asia/Bangkok',
  PH: 'Asia/Manila', MY: 'Asia/Kuala_Lumpur', ID: 'Asia/Jakarta',
  KW: 'Asia/Kuwait', TN: 'Africa/Tunis', CI: 'Africa/Abidjan',
  KE: 'Africa/Nairobi', CA: 'America/Toronto', HR: 'Europe/Zagreb',
  BO: 'America/La_Paz', CY: 'Asia/Nicosia',
}

function localTimeToUtc(dateStr: string, h: number, m: number, tz: string): string | null {
  try {
    const [y, mo, d] = dateStr.split('-').map(s => parseInt(s, 10))
    if (!y || !mo || !d) return null
    const asIfUtc = Date.UTC(y, mo - 1, d, h, m, 0)
    const probe = new Date(asIfUtc)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(probe)
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10)
    let lh = get('hour'); if (lh === 24) lh = 0
    const wallClockInTz = Date.UTC(get('year'), get('month') - 1, get('day'), lh, get('minute'), 0)
    const offsetMs = wallClockInTz - asIfUtc
    return new Date(asIfUtc - offsetMs).toISOString()
  } catch {
    return null
  }
}

interface Candidate {
  match_id: string
  tournament_id: string
  tournament_name: string
  country: string | null
  timezone: string | null
  match_widget_id: string
  court: string | null
  court_position: number | null
  scheduled_label: string
  day_date: string
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    // Find every match with scheduled_at IS NULL, status='scheduled',
    // matched to its latest oop_snapshot via widget_id_composite.
    const filter = TOURNAMENT_FILTER ? `AND m.tournament_id = '${TOURNAMENT_FILTER}'` : ''
    const r = await client.query(`
      WITH latest_oop AS (
        SELECT DISTINCT ON (s.tournament_id, s.match_widget_id)
          s.tournament_id, s.match_widget_id, s.court, s.court_position,
          s.scheduled_label, s.day_date, s.captured_at
        FROM padelgod.oop_snapshots s
        WHERE s.match_widget_id IS NOT NULL
          AND s.day_date IS NOT NULL
          AND s.scheduled_label IS NOT NULL
        ORDER BY s.tournament_id, s.match_widget_id, s.captured_at DESC
      )
      SELECT
        m.id AS match_id,
        m.tournament_id,
        t.name AS tournament_name,
        t.country, t.timezone,
        o.match_widget_id, o.court, o.court_position,
        o.scheduled_label, o.day_date::text
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN latest_oop o ON o.tournament_id = m.tournament_id
        AND m.widget_id_composite LIKE '%:' || o.match_widget_id
      WHERE m.scheduled_at IS NULL
        AND m.status IN ('scheduled', 'live')
        ${filter}
      ORDER BY m.tournament_id, o.court, o.court_position
    `)
    const candidates = r.rows as Candidate[]
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Found ${candidates.length} candidate matches`)

    // Group by (tournament, court) for "Followed by" chaining
    type Group = Map<string, Candidate[]>
    const byTournament = new Map<string, Map<string, Candidate[]>>()
    for (const c of candidates) {
      let courts = byTournament.get(c.tournament_id)
      if (!courts) { courts = new Map(); byTournament.set(c.tournament_id, courts) }
      const courtKey = c.court ?? '__none__'
      let arr = courts.get(courtKey)
      if (!arr) { arr = []; courts.set(courtKey, arr) }
      arr.push(c)
    }

    let written = 0, skippedNoTz = 0, skippedUnparsable = 0
    for (const [tournamentId, courts] of byTournament) {
      const sample = candidates.find(c => c.tournament_id === tournamentId)!
      const tz = sample.timezone || (sample.country ? COUNTRY_TIMEZONES[sample.country.toUpperCase()] ?? null : null)
      if (!tz) {
        console.log(`  SKIP tournament ${sample.tournament_name} — no timezone (country=${sample.country})`)
        skippedNoTz += [...courts.values()].reduce((s, a) => s + a.length, 0)
        continue
      }

      for (const [, courtRows] of courts) {
        courtRows.sort((a, b) => (a.court_position ?? 0) - (b.court_position ?? 0))
        let lastTime: Date | null = null
        for (const row of courtRows) {
          let scheduledAt: string | null = null
          const tm = TIME_RE.exec(row.scheduled_label)
          if (tm) {
            let h = parseInt(tm[1]); const mn = parseInt(tm[2])
            const ap = tm[3].toUpperCase()
            if (ap === 'PM' && h < 12) h += 12
            if (ap === 'AM' && h === 12) h = 0
            scheduledAt = localTimeToUtc(row.day_date, h, mn, tz)
            if (scheduledAt) lastTime = new Date(scheduledAt)
          } else if (/followed by/i.test(row.scheduled_label)) {
            if (lastTime) {
              const est = new Date(lastTime.getTime() + FOLLOWED_BY_GAP_MINUTES * 60 * 1000)
              scheduledAt = est.toISOString()
              lastTime = est
            }
          }

          if (!scheduledAt) {
            skippedUnparsable++
            continue
          }

          if (DRY_RUN) {
            console.log(`  [dry] ${sample.tournament_name} | ${row.match_widget_id} | ${row.scheduled_label} → ${scheduledAt}`)
          } else {
            const upd = await client.query(
              `UPDATE matches SET scheduled_at = $1, schedule_label = $2, updated_at = NOW()
               WHERE id = $3 AND scheduled_at IS NULL`,
              [scheduledAt, row.scheduled_label, row.match_id],
            )
            if (upd.rowCount && upd.rowCount > 0) {
              console.log(`  OK   ${sample.tournament_name} | ${row.match_widget_id} | ${row.scheduled_label} → ${scheduledAt}`)
            } else {
              console.log(`  RACE ${sample.tournament_name} | ${row.match_widget_id} (scheduled_at was set between read and write)`)
              continue
            }
          }
          written++
        }
      }
    }

    console.log(`\nDone. written=${written} skippedNoTz=${skippedNoTz} skippedUnparsable=${skippedUnparsable}`)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
