/**
 * Check entry-list freshness for one or all active padelgod tournaments.
 *
 * Reports per tournament:
 *   - latest entry_list_snapshots captured_at per category, with age
 *   - latest scrape_jobs row matching parser_version=fip_pdf_entry_list_v1
 *     (status, error, age)
 *
 * Usage:
 *   npx tsx scripts/check-entry-list-freshness.ts                # all active
 *   npx tsx scripts/check-entry-list-freshness.ts <tournament_id>  # one
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

function ageStr(iso: string | null): string {
  if (!iso) return 'NEVER'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

async function main() {
  const arg = process.argv[2]

  let tournaments: { tournament_id: string; tournament_name: string }[]
  if (arg) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('id', arg)
      .maybeSingle()
    if (error) throw error
    if (!data) { console.error(`tournament ${arg} not found`); process.exit(1) }
    tournaments = [{ tournament_id: data.id, tournament_name: data.name }]
  } else {
    const { data, error } = await supabase.rpc('padelgod_active_tournaments_with_slug')
    if (error) throw error
    tournaments = (data ?? []) as any
  }

  console.log(`Checking ${tournaments.length} tournament(s)\n`)

  for (const t of tournaments) {
    // Latest snapshot per category
    const { data: snaps, error: sErr } = await supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('category, captured_at')
      .eq('tournament_id', t.tournament_id)
      .order('captured_at', { ascending: false })
      .limit(500)
    if (sErr) { console.error(`  snapshots err: ${sErr.message}`); continue }

    const latestPerCat: Record<string, { capturedAt: string; rowCount: number }> = {}
    for (const r of (snaps ?? [])) {
      const cat = r.category as string
      if (!latestPerCat[cat]) {
        latestPerCat[cat] = { capturedAt: r.captured_at, rowCount: 0 }
      }
      if (r.captured_at === latestPerCat[cat]!.capturedAt) {
        latestPerCat[cat]!.rowCount++
      }
    }

    // Latest scrape_job for FIP PDF entry list
    const { data: jobs, error: jErr } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .select('status, error_message, started_at, completed_at, duration_ms, target_url')
      .eq('tournament_id', t.tournament_id)
      .eq('parser_version', 'fip_pdf_entry_list_v1')
      .order('started_at', { ascending: false })
      .limit(4)
    if (jErr) { console.error(`  scrape_jobs err: ${jErr.message}`); continue }

    console.log(`${t.tournament_name}`)
    console.log(`  ${t.tournament_id}`)
    if (Object.keys(latestPerCat).length === 0) {
      console.log(`  snapshots: NONE`)
    } else {
      for (const [cat, info] of Object.entries(latestPerCat)) {
        console.log(`  ${cat}: ${info.rowCount} rows | latest ${info.capturedAt} (${ageStr(info.capturedAt)})`)
      }
    }
    if ((jobs ?? []).length === 0) {
      console.log(`  scrape_jobs: NONE`)
    } else {
      for (const j of jobs!) {
        const url = (j.target_url ?? '').slice(-30)
        const err = j.error_message ? ` ERR:${j.error_message.slice(0, 80)}` : ''
        const dur = j.duration_ms ? ` ${j.duration_ms}ms` : ''
        console.log(`  job: [${j.status}]${dur} ${ageStr(j.started_at)} ...${url}${err}`)
      }
    }
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
