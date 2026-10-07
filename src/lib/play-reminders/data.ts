import type { SupabaseClient } from '@supabase/supabase-js'
import { roundKey } from '@/lib/match-quality'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  MARKET_SELECT,
  describeMarket,
  parseLocale,
  type MarketRow,
} from '@/app/api/play/_shared'
import type { ReminderMarket } from './plan'
export async function loadReminderMarkets(
  db: SupabaseClient,
  locale: string,
  now: number,
  ids?: string[]
): Promise<ReminderMarket[]> {
  const select = MARKET_SELECT.replace(
    'tokens, lineup_snapshot',
    'lineup_fingerprint, tokens, lineup_snapshot'
  ).replace(
    'category, pred_pair1_prob,',
    'category, pred_pair1_prob, lineup_fingerprint, pred_lineup_fingerprint,'
  )
  const rows = await paginatedSelect<
    MarketRow & {
      lineup_fingerprint: string | null
      match: MarketRow['match'] & {
        lineup_fingerprint: string | null
        pred_lineup_fingerprint: string | null
      }
    }
  >(
    (a, b) => {
      let q = db
        .from('markets')
        .select(select)
        .eq('status', 'open')
        .gt('locks_at', new Date(now).toISOString())
        .not('match_id', 'is', null)
        .order('id')
        .range(a, b)
      if (ids) q = q.in('id', ids)
      return q
    },
    { what: 'reminder markets' }
  )
  return rows.flatMap((row) => {
    const v = describeMarket(row, parseLocale(locale), now),
      m = row.match
    if (!m || !v.players || !v.startsAt || !v.matchId) return []
    const player = (p: (typeof v.players.pair1)[number]) => ({
      id: p.id!,
      name: p.surname || p.name,
      image: p.avatarUrl,
    })
    return [
      {
        id: v.id,
        matchId: v.matchId,
        question: v.question,
        pair1: v.players.pair1.filter((p) => p.id !== null).map(player),
        pair2: v.players.pair2.filter((p) => p.id !== null).map(player),
        tournament: v.competition ?? '',
        round:
          roundKey(m.round) === 'final' ? 'F' : roundKey(m.round).toUpperCase(),
        category: v.category ?? '',
        startsAt: v.startsAt,
        locksAt: v.locksAt,
        status: row.status,
        matchStatus: m.status ?? '',
        lineup: m.lineup_fingerprint,
        marketLineup: row.lineup_fingerprint,
        predictionLineup:
          m.pred_pair1_prob == null ? null : m.pred_lineup_fingerprint,
        requiresPrediction: row.seed_source === 'elo',
      },
    ]
  })
}
export async function loadUserChoices(db: SupabaseClient, userId: string) {
  const [trades, bookmarks] = await Promise.all([
    paginatedSelect<{ market_id: string }>(
      (a, b) =>
        db
          .from('market_trades')
          .select('market_id')
          .eq('user_id', userId)
          .order('id')
          .range(a, b),
      { what: 'reminder previous plays' }
    ),
    paginatedSelect<{ bookmark_type: string; target_id: string }>(
      (a, b) =>
        db
          .from('user_bookmarks')
          .select('bookmark_type,target_id')
          .eq('user_id', userId)
          .order('id')
          .range(a, b),
      { what: 'reminder bookmarks' }
    ),
  ])
  return {
    answered: new Set(trades.map((t) => t.market_id)),
    followed: new Set(
      bookmarks
        .filter((b) => b.bookmark_type === 'player')
        .map((b) => b.target_id)
    ),
    bookmarked: new Set(
      bookmarks
        .filter((b) => b.bookmark_type === 'match')
        .map((b) => b.target_id)
    ),
  }
}
