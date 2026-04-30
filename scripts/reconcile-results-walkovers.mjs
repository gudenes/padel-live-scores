// Re-fetch the Crionet results widget for active tournaments and reapply
// the corrected `parseCrionetResults` (which now captures walkovers + RET).
//
// Why: the old parser dropped any results row whose set cells were all "-",
// which is the exact signature of a walkover. Affected matches were stuck
// at `status='scheduled'` even after the actual fixture was decided. The
// parser fix is in padelgod (next Railway deploy picks it up); this script
// rewrites the rows that already drifted.
//
// Defaults to dry-run; pass --apply to mutate.
//
// Run: node scripts/reconcile-results-walkovers.mjs [--apply] [--tournament=<uuid>] [--days=14]

import { promises as fs } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'

async function loadEnv() {
  const text = await fs.readFile('.env.local', 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

// ─── Inline parser (mirrors padelgod/src/parsers/crionet-results.ts post-fix) ──

const TABLE_SELECTOR = 'table.w-100'
const HEADER_SELECTOR = 'tr.scorebox-header-completed'
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name'
const ROUND_BLOCK_SELECTOR = '.round-name'
const TEAM_ROW_SELECTOR = 'tr:has(td.team)'
const TEAM_SELECTOR = 'td.team'
const SET_SELECTOR = 'td.set'
const STATS_BUTTON_SELECTOR = 'a.open'

function parseCategoryFromRoundBlock($block) {
  const text = $block.text().trim().toLowerCase()
  if (text.startsWith('men')) return 'men'
  if (text.startsWith('women')) return 'women'
  return null
}
function parseRoundLabel($block) {
  const inner = $block.find('div').first().text().trim()
  return inner || null
}
function parseTeam($, td) {
  const hasWinner = td.html()?.includes('fa-check') === true ||
    td.find('[class*="winner"]').length > 0
  const badge = td.find('small.badge').first()
  const badgeText = badge.length > 0 ? badge.text().trim().toUpperCase() : null
  const isMissingTeam = td.find('.missingteam').length > 0
  const playerNames = []
  td.find('div').each((_, el) => {
    const $el = $(el)
    const cls = $el.attr('class') ?? ''
    if (!/(?:^|\s)(?:ml-2|ms-2)(?:\s|$)/.test(cls)) return
    if ($el.find('.missingteam').length > 0) return
    const spans = $el.find('> span')
    if (spans.length === 0) return
    const parts = []
    spans.each((_, span) => {
      const text = $(span).text().trim()
      if (text) parts.push(text)
    })
    if (parts.length === 0) return
    playerNames.push(parts.join(' ').trim())
  })
  return { player1: playerNames[0] ?? null, player2: playerNames[1] ?? null, hasWinner, badgeText, isMissingTeam }
}
function badgeToStatus(badgeText) {
  if (!badgeText) return null
  if (/^W[\/\s]?O$/i.test(badgeText)) return 'walkover'
  if (/^RET$/i.test(badgeText)) return 'retired'
  return null
}
function parseSetCell($, td) {
  const sup = td.find('sup').first()
  const tb = sup.length > 0 ? parseInt(sup.text().trim(), 10) : null
  sup.remove()
  const games = td.text().trim()
  return { games, tb: isNaN(tb) ? null : tb }
}
function parseCrionetResults(html) {
  const $ = cheerio.load(html)
  const out = []
  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table)
    const header = $t.find(HEADER_SELECTOR).first()
    if (header.length === 0) return
    const court = header.find(COURT_LABEL_SELECTOR).first().text().trim() || null
    const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first()
    const category = parseCategoryFromRoundBlock(roundBlock)
    if (!category) return
    const roundLabel = parseRoundLabel(roundBlock)
    const teamRows = $t.find(TEAM_ROW_SELECTOR)
    if (teamRows.length < 2) return
    const team1Row = teamRows.eq(0)
    const team2Row = teamRows.eq(1)
    const team1 = parseTeam($, team1Row.find(TEAM_SELECTOR).first())
    const team2 = parseTeam($, team2Row.find(TEAM_SELECTOR).first())
    const t1Cells = team1Row.find(SET_SELECTOR).map((_, el) => parseSetCell($, $(el))).get()
    const t2Cells = team2Row.find(SET_SELECTOR).map((_, el) => parseSetCell($, $(el))).get()
    const sets = []
    for (let i = 0; i < Math.max(t1Cells.length, t2Cells.length); i++) {
      const a = t1Cells[i] ?? { games: '-', tb: null }
      const b = t2Cells[i] ?? { games: '-', tb: null }
      if (a.games === '-' && b.games === '-') continue
      const tb = a.tb !== null ? `(${a.tb})` : b.tb !== null ? `(${b.tb})` : ''
      sets.push(`${a.games}-${b.games}${tb}`)
    }
    const setScores = sets.join(' ')
    const badgeStatus = badgeToStatus(team1.badgeText) ?? badgeToStatus(team2.badgeText)
    const missingTeamStatus = (team1.isMissingTeam || team2.isMissingTeam) ? 'walkover' : null
    const terminalStatus = badgeStatus ?? missingTeamStatus
    if (sets.length === 0 && !terminalStatus) return
    const winnerTeam = team1.isMissingTeam ? 2 : team2.isMissingTeam ? 1 : team1.hasWinner ? 1 : 2
    const button = $t.find(STATS_BUTTON_SELECTOR).first()
    const matchWidgetId = button.attr('data-id') ?? null
    out.push({
      category, roundLabel, court, matchWidgetId,
      team1Player1Name: team1.player1, team1Player2Name: team1.player2,
      team2Player1Name: team2.player1, team2Player2Name: team2.player2,
      setScores, winnerTeam,
      status: terminalStatus ?? 'finished',
    })
  })
  return out
}

// ─── Reconcile loop ──

const apply = process.argv.includes('--apply')
const tournamentArg = process.argv.find(a => a.startsWith('--tournament='))
const onlyTournament = tournamentArg ? tournamentArg.split('=')[1] : null
const daysArg = process.argv.find(a => a.startsWith('--days='))
const lookbackDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : 14

await loadEnv()
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Reconciling Crionet walkovers (last ${lookbackDays} days)…\n`)

// 1. Source the tournament list from widget_id_cache (small table, no row-cap risk)
//    intersected with tournaments that are currently in window. Not relying on
//    OOP table because oop_snapshots can hit the PostgREST 10k cap and silently
//    truncate, which would skip whichever tournaments don't make the cut.
const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString()
const horizon = new Date(Date.now() + 7 * 86400000).toISOString()
let widgetsQ = s.schema('padelgod').from('widget_id_cache')
  .select('tournament_id, widget_id')
  .eq('is_active', true)
if (onlyTournament) widgetsQ = widgetsQ.eq('tournament_id', onlyTournament)
const { data: widgets } = await widgetsQ
const widgetByTour = new Map((widgets ?? []).map(w => [w.tournament_id, w.widget_id]))

// Only keep tournaments that are currently active (window: cutoff → horizon).
// Chunk the IN query — 399 widgets in a single .in() blows the URL length.
const candidateIds = [...widgetByTour.keys()]
const activeIds = new Set()
for (let i = 0; i < candidateIds.length; i += 100) {
  const chunk = candidateIds.slice(i, i + 100)
  const { data: act } = await s.from('tournaments')
    .select('id')
    .in('id', chunk)
    .gte('ends_at', cutoff)
    .lte('starts_at', horizon)
  for (const t of act ?? []) activeIds.add(t.id)
}

// For day enumeration, just try days 1..7 (most tournaments are 4–5 days,
// some run 7). Cheap to over-fetch — bad URLs return 404 and we skip them.
const tournamentDays = new Map()
for (const tid of activeIds) {
  tournamentDays.set(tid, new Set([1, 2, 3, 4, 5, 6, 7]))
}
console.log(`Active tournaments with widgets: ${tournamentDays.size}`)
const tournamentIds = [...tournamentDays.keys()]

const updates = []
let scanned = 0

for (const [tid, days] of tournamentDays) {
  const tw = widgetByTour.get(tid)
  if (!tw) continue

  // 3. Fetch results HTML for each day
  for (const day of [...days].sort()) {
    const url = `https://widget.matchscorerlive.com/screen/resultsbyday/${tw}/${day}?t=tol`
    let html
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'PadelNachos/reconcile' } })
      if (!res.ok) continue
      html = await res.text()
    } catch { continue }
    const parsed = parseCrionetResults(html)
    scanned += parsed.length

    // 4. Look up matches by composite for this batch
    const composites = parsed.filter(p => p.matchWidgetId).map(p => `${tw}:${p.matchWidgetId}`)
    if (composites.length === 0) continue
    const { data: matches } = await s.from('matches')
      .select('id, widget_id_composite, status, winner_pair, finished_at, tournament:tournaments(name)')
      .in('widget_id_composite', composites)
    const byComp = new Map((matches ?? []).map(m => [m.widget_id_composite, m]))

    for (const p of parsed) {
      if (!p.matchWidgetId) continue
      const composite = `${tw}:${p.matchWidgetId}`
      const m = byComp.get(composite)
      if (!m) continue
      // Only fix matches that are still pre-terminal (don't clobber finished rows).
      if (!['scheduled', 'on_court', 'live'].includes(m.status)) continue
      // Skip rows where the parser would still emit `finished` with no scores
      // (defensive — shouldn't happen post-fix).
      if (p.status === 'finished' && !p.setScores) continue
      updates.push({
        matchId: m.id,
        composite,
        tournamentName: m.tournament?.name,
        from: m.status,
        to: p.status,
        winnerTeam: p.winnerTeam,
        setScores: p.setScores,
      })
    }
  }
}

console.log(`Scanned ${scanned} parsed match rows`)
console.log(`Status updates: ${updates.length}\n`)

const byTour = new Map()
for (const u of updates) {
  if (!byTour.has(u.tournamentName)) byTour.set(u.tournamentName, [])
  byTour.get(u.tournamentName).push(u)
}
for (const [name, list] of [...byTour.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`⚠ ${name}  (${list.length})`)
  for (const u of list.slice(0, 8)) {
    console.log(`  ${u.composite}  ${u.from} → ${u.to}  winner=${u.winnerTeam}  scores="${u.setScores}"`)
  }
  if (list.length > 8) console.log(`    …and ${list.length - 8} more`)
}
console.log()

if (!apply) {
  console.log('[DRY RUN] No writes. Re-run with --apply.')
  process.exit(0)
}

let ok = 0, failed = 0
for (const u of updates) {
  const patch = {
    status: u.to,
    winner_pair: u.winnerTeam,
    last_updated_by: 'padelgod',
    updated_at: new Date().toISOString(),
  }
  // Stamp finished_at when not already set (we don't have a precise time)
  patch.finished_at = new Date().toISOString()
  const { error } = await s.from('matches').update(patch).eq('id', u.matchId).in('status', ['scheduled', 'on_court', 'live'])
  if (error) { console.log(`  ✗ ${u.matchId}: ${error.message}`); failed++ } else ok++
}
console.log(`\nDone. updated=${ok} failed=${failed}`)
