// src/lib/notification-catalog.ts
// Pure shaping for the ops Notifications console: join CATEGORY_META with
// notification_sends aggregates and derive a live/idle/soon status.
import { CATEGORY_META, KNOWN_CATEGORIES, type NotificationCategory } from '@/lib/notification-categories'

export type CategoryStatus = 'live' | 'idle' | 'soon'

export type CategoryRule = { rule: string; sampleTitle: string; sampleBody: string }

// Operator-facing documentation: how each category fires + a representative
// sample for the per-row "Test to me". Keep rules accurate to the sender logic.
export const CATEGORY_RULES: Record<NotificationCategory, CategoryRule> = {
  match_live_follow:    { rule: "When a followed player's match goes live (scheduled → live). → that player's followers. Live now.", sampleTitle: 'Tapia is on court! 🟢', sampleBody: 'Tapia/Coello vs Galán/Chingotto — Madrid P1, QF.' },
  match_live_bookmark:  { rule: 'When a bookmarked match goes live. → users who bookmarked the match. Live now.', sampleTitle: 'Match is live! 🟢', sampleBody: 'A match you saved just started — Madrid P1, QF.' },
  match_finished:       { rule: 'When a followed/bookmarked match finishes. → match followers + bookmarkers. Live now.', sampleTitle: 'Match finished 🏆', sampleBody: 'Tapia/Coello beat Galán/Chingotto 6-4 3-6 6-2.' },
  match_scheduled:      { rule: 'Once, when a followed match first gets a firm time + court. → match followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-oop-writer).', sampleTitle: 'Madrid P1: match scheduled', sampleBody: 'A match you follow now has a time and court.' },
  match_deciding_set:   { rule: 'When a followed Premier match reaches a deciding 3rd set. → match followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Going the distance!', sampleBody: 'Tapia/Coello forced a deciding 3rd set — 6-4 3-6.' },
  match_upset_live:     { rule: 'When an underdog leads a followed Premier match live. → match followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Upset in progress', sampleBody: 'An underdog is leading a match you follow.' },
  next_match_drawn:     { rule: "When a followed player's next-round opponent is set after a win. → that player's followers. Pro · no sender yet (Plan 3).", sampleTitle: 'Next match drawn', sampleBody: "Tapia's next: QF vs Stupaczuk/Di Nenno." },
  player_title_won:     { rule: "When a followed player wins a final. → that player's followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-results-writer).", sampleTitle: 'Champion! 🏆', sampleBody: 'Your player just won the title.' },
  player_eliminated:    { rule: "When a followed player loses (any non-final finish). → that player's followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-results-writer).", sampleTitle: 'Knocked out', sampleBody: 'Your player was eliminated.' },
  ranking_updated:      { rule: "Weekly, when FIP rankings refresh and a followed player moves. → that player's followers. No automated sender wired yet.", sampleTitle: 'Rankings updated', sampleBody: "Your players moved in this week's rankings." },
  ranking_threshold:    { rule: "When a followed player crosses #1 / top 10 / top 20. → that player's followers. Pro · no sender yet (Plan 3).", sampleTitle: 'Ranking milestone', sampleBody: 'Ariana Sánchez is back to World No. 1.' },
  projection_outperform:{ rule: 'When a followed pair advances past their projected finish (Road to Trophy). → followers. Pro · Premier-only · no sender yet (Plan 3).', sampleTitle: 'Beating the bracket', sampleBody: 'Your pick went further than the model expected!' },
  tournament_starting:  { rule: "Once, when a followed tournament's start time passes (within a 24h window). → tournament followers. Gated by ENABLE_TOURNAMENT_START_NOTIFIER (padelgod tournament-start-notifier).", sampleTitle: 'Madrid P1 is underway', sampleBody: 'Play has started — follow the action and order of play.' },
  draw_released:        { rule: 'Once per tournament + category, when its bracket first appears. → tournament followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-draw-populator).', sampleTitle: 'Draw is out', sampleBody: 'The bracket for an event you follow has been published.' },
  player_entered:       { rule: "Once per tournament + player, when a followed player first appears in an entry list. → that player's followers. Gated by ENABLE_EVENT_NOTIFICATIONS (padelgod fip-entry-list-populator).", sampleTitle: 'New tournament entry', sampleBody: 'A player you follow just entered an event.' },
  player_path:          { rule: "A followed player's draw position + next opponent. → that player's followers. Pro · no sender yet (Plan 3).", sampleTitle: "Tapia's path", sampleBody: 'Round of 16 · next: winner of Stupa/Di Nenno.' },
  prematch_prediction:  { rule: 'Model win-probability before a followed match. → match/player followers. Pro · no sender yet (Plan 3).', sampleTitle: 'Pre-match: Tapia/Coello 68%', sampleBody: "Our model favours them in today's QF." },
  daily_oop:            { rule: "Morning briefing of your players' matches today. → followers. Pro · no sender yet (Plan 4 digest).", sampleTitle: 'Your players today (3)', sampleBody: 'Tapia 18:00 · Galán 19:30 · Sánchez 16:00.' },
  weekly_digest:        { rule: "Weekly recap: your players' week + weekend champions + the week ahead. → opted-in followers. No sender yet (Plan 4 batch job).", sampleTitle: 'Your week in padel', sampleBody: "Weekend champions + how your players did + what's next." },
  tournament_wrapup:    { rule: 'Recap when a followed tournament ends: champions + notable results. → tournament followers. Pro · no sender yet (Plan 4 digest).', sampleTitle: 'Madrid P1 wrap-up', sampleBody: "Champions crowned + the weekend's standout results." },
  marketing:            { rule: 'Manual product announcements. → opted-in users (opt-out model). Sent ad-hoc; no scheduled sender.', sampleTitle: 'New in PadelNachos', sampleBody: 'Check out the latest update.' },
}

const LIVE_WINDOW_MS = 7 * 24 * 3600_000

export function deriveCategoryStatus(
  input: { comingSoon: boolean; lastFiredAt: string | null },
  now: number,
): CategoryStatus {
  if (input.lastFiredAt && now - Date.parse(input.lastFiredAt) <= LIVE_WINDOW_MS) return 'live'
  if (input.comingSoon) return 'soon'
  return 'idle'
}

export type SendAgg = {
  category: string
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
}

export type CatalogRow = {
  key: NotificationCategory
  tier: 'free' | 'pro'
  group: string
  comingSoon: boolean
  status: CategoryStatus
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
  description: string
  sample: { title: string; body: string }
}

export function buildCatalog(aggs: SendAgg[], now: number): CatalogRow[] {
  const byCat = new Map(aggs.map((a) => [a.category, a]))
  return KNOWN_CATEGORIES.map((key) => {
    const meta = CATEGORY_META[key]
    const agg = byCat.get(key)
    return {
      key,
      tier: meta.tier,
      group: meta.group,
      comingSoon: meta.comingSoon,
      status: deriveCategoryStatus({ comingSoon: meta.comingSoon, lastFiredAt: agg?.lastFiredAt ?? null }, now),
      lastFiredAt: agg?.lastFiredAt ?? null,
      count7d: agg?.count7d ?? 0,
      recipients7d: agg?.recipients7d ?? 0,
      failed7d: agg?.failed7d ?? 0,
      description: CATEGORY_RULES[key].rule,
      sample: { title: CATEGORY_RULES[key].sampleTitle, body: CATEGORY_RULES[key].sampleBody },
    }
  })
}
