// src/app/api/play/markets/route.ts
// GET /api/play/markets?locale=en
//
// The Play home rail: open, not-yet-locked markets, soonest lock first.
//
// Bounded at 30 rows and filtered to `status='open'` with a future `locks_at`,
// so this read cannot grow past the PostgREST 10k cap and does not need
// db-paginate.

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

  const locale = parseLocale(new URL(req.url).searchParams.get('locale'))
  const nowIso = new Date().toISOString()

  // `locks_at` ascending = "closing soonest first". The brief says
  // "newest-locking first"; for a market list the useful ordering is the one
  // that surfaces what is about to become untradeable, which is also what the
  // `markets_status_locks_idx` index serves.
  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('status', 'open')
    .gt('locks_at', nowIso)
    .order('locks_at', { ascending: true })
    .limit(LIMIT)

  if (error) {
    console.error('[play/markets] query failed:', error.message)
    return Response.json({ error: 'query_failed' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as MarketRow[]
  const now = Date.now()

  // Both signals are fetched ONCE for the whole page — see _signals.ts. They
  // are also both optional: either one failing leaves its field null and the
  // card drops that line, rather than failing the deck.
  const [form, h2h] = await Promise.all([
    fetchRecentForm(supabase, collectPlayerIds(rows)),
    fetchHeadToHead(supabase, rows),
  ])

  return Response.json({
    markets: rows.map((r) => ({ ...describeMarket(r, locale, now, { form, h2h }), book: { qYes: Number(r.q_yes), qNo: Number(r.q_no), b: Number(r.lmsr_b) } })),
  })
}
