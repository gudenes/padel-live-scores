// src/app/api/play/markets/route.ts
// GET /api/play/markets?locale=en
//
// The Play home rail: open, not-yet-locked markets, soonest lock first.
//
// Bounded at 30 rows and filtered to `status='open'` with a future `locks_at`,
// so this read cannot grow past the PostgREST 10k cap and does not need
// db-paginate.

import { fetchEditorialViews } from '../_editorial'
import { requirePlayAccess } from '@/lib/play-access'
import {
  MARKET_SELECT,
  describeMarket,
  parseLocale,
  playNotFound,
  type MarketRow,
} from '../_shared'
import { collectPlayerIds, fetchHeadToHead, fetchRecentForm } from '../_signals'

export const dynamic = 'force-dynamic'

const LIMIT = 30

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase } = access

  const params = new URL(req.url).searchParams
  const locale = parseLocale(params.get('locale'))
  const matchId = params.get('matchId')
  if (matchId && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(matchId)) return Response.json({error:'invalid_match'}, {status:400})
  const nowIso = new Date().toISOString()

  // `locks_at` ascending = "closing soonest first". The brief says
  // "newest-locking first"; for a market list the useful ordering is the one
  // that surfaces what is about to become untradeable, which is also what the
  // `markets_status_locks_idx` index serves.
  let query = supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('status', 'open')
    .gt('locks_at', nowIso)
    .order('locks_at', { ascending: true })
    .limit(LIMIT)
  if (matchId) query = query.eq('match_id', matchId)
  const {data, error} = await query

  if (error) {
    console.error('[play/markets] query failed:', error.message)
    return Response.json({ error: 'query_failed' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as MarketRow[]
  const now = Date.now()

  // Both signals are fetched ONCE for the whole page — see _signals.ts. They
  // are also both optional: either one failing leaves its field null and the
  // card drops that line, rather than failing the deck.
  const [editorial, form, h2h] = await Promise.all([
    fetchEditorialViews(supabase, rows),
    fetchRecentForm(supabase, collectPlayerIds(rows)),
    fetchHeadToHead(supabase, rows),
  ])

  return Response.json({
    markets: rows.map((r) => ({ ...describeMarket(r, locale, now, { form, h2h, editorial }), book: { qYes: Number(r.q_yes), qNo: Number(r.q_no), b: Number(r.lmsr_b) } })),
  })
}
