/** Editorial planning, deliberately separate from markets that accept Guacas. */
export const ROTTERDAM_ID = 'f5975267-7748-4a6a-9e21-3498ec0f04a5'
export const MAIN_DRAW_ROUNDS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
export type MarketDraft = {
  id: 'rotterdam-bagel-men' | 'rotterdam-bagel-women' | 'daily-pick' | 'lebron-augsburger'
  kind: 'tournament-bagel' | 'daily-match' | 'partnership'
  title: string
  rules: string
  closesAt: string | null
  tournamentId: string | null
  matchId: string | null
  category: 'both' | 'men' | 'women'
  openingProbability: number | null
  probabilitySource: string
  updatedAt: string | null
}
export function initialDrafts(): MarketDraft[] {
  return [
    {
      id: 'rotterdam-bagel-men', kind: 'tournament-bagel',
      title: 'Will there be a 6–0 set in the Rotterdam P2 men’s main draw?',
      tournamentId: ROTTERDAM_ID, matchId: null, category: 'men',
      closesAt: '2026-10-04T21:59:59.000Z', openingProbability: null, probabilitySource: '', updatedAt: null,
      rules: 'YES if at least one completed 6–0 or 0–6 set is recorded in the men’s main draw of Rotterdam P2 2026. Qualifying, walkovers and match tiebreaks do not count. A completed set before a retirement counts. Trading closes immediately when a qualifying 6–0 is confirmed, or when the men’s draw finishes, whichever comes first. Settlement waits until the tournament finishes and official scores are verified. NO requires complete main-draw coverage and no qualifying set. Missing scores require review; cancellation without a qualifying set voids the market. A postponed final delays settlement.',
    },
    {
      id: 'rotterdam-bagel-women', kind: 'tournament-bagel',
      title: 'Will there be a 6–0 set in the Rotterdam P2 women’s main draw?',
      tournamentId: ROTTERDAM_ID, matchId: null, category: 'women',
      closesAt: '2026-10-04T21:59:59.000Z', openingProbability: null, probabilitySource: '', updatedAt: null,
      rules: 'YES if at least one completed 6–0 or 0–6 set is recorded in the women’s main draw of Rotterdam P2 2026. Qualifying, walkovers and match tiebreaks do not count. A completed set before a retirement counts. Trading closes immediately when a qualifying 6–0 is confirmed, or when the women’s draw finishes, whichever comes first. Settlement waits until the tournament finishes and official scores are verified. NO requires complete main-draw coverage and no qualifying set. Missing scores require review; cancellation without a qualifying set voids the market. A postponed final delays settlement.',
    },
    {
      id: 'daily-pick', kind: 'daily-match', title: 'Match of the day',
      tournamentId: ROTTERDAM_ID, matchId: null, category: 'both', closesAt: null,
      openingProbability: null, probabilitySource: '', updatedAt: null,
      rules: 'Select one main-draw match for the day. YES means the first listed pair wins; NO means the second pair wins. Trading closes at the scheduled start, or earlier if play begins. Settle from the confirmed match winner. A retirement with an official winner counts; a walkover or cancellation voids the market. Reuse an existing winner market for the match rather than opening a duplicate.',
    },
    {
      id: 'lebron-augsburger', kind: 'partnership',
      title: 'Will Lebrón and Augsburger still be partners on December 8?',
      tournamentId: null, matchId: null, category: 'men',
      closesAt: '2026-12-08T22:59:59.000Z', openingProbability: null, probabilitySource: '', updatedAt: null,
      rules: 'Reference time: December 8, 2026 at 23:59:59 Europe/Madrid. YES if Juan Lebrón and Leo Augsburger are confirmed as an ongoing partnership at that time. NO if an official statement from either player or their team confirms the partnership has ended with effect on or before that time. A future split effective after the deadline does not count. Injuries, temporary substitutes, exhibition partners and rumours alone do not establish a split. Require dated official evidence for either answer; an operator reviews the evidence and records the source URL. Ambiguous evidence remains under review. This market uses the specified date, not an inferred end of season.',
    },
  ]
}
export function validateDraft(raw: unknown): MarketDraft {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid draft.')
  const d = raw as MarketDraft
  const initial = initialDrafts().find(item => item.id === d.id)
  if (!initial || d.kind !== initial.kind || d.tournamentId !== initial.tournamentId) throw new Error('Unknown market draft.')
  if (typeof d.title !== 'string' || d.title.trim().length < 10 || d.title.length > 240) throw new Error('Use a title between 10 and 240 characters.')
  if (typeof d.rules !== 'string' || d.rules.trim().length < 40 || d.rules.length > 5000) throw new Error('Add clear resolution rules (40–5000 characters).')
  if (d.kind === 'tournament-bagel' && d.category !== initial.category) throw new Error('Each bagel draft belongs to one fixed draw.')
  if (!['both', 'men', 'women'].includes(d.category)) throw new Error('Choose a draw.')
  if (d.matchId !== null && (typeof d.matchId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(d.matchId))) throw new Error('Invalid match.')
  if (d.kind !== 'daily-match' && d.matchId !== null) throw new Error('This market is not about one match.')
  if (d.closesAt !== null && (typeof d.closesAt !== 'string' || !Number.isFinite(Date.parse(d.closesAt)))) throw new Error('Invalid closing date.')
  if (d.openingProbability !== null && (typeof d.openingProbability !== 'number' || !Number.isFinite(d.openingProbability) || d.openingProbability < .02 || d.openingProbability > .98)) throw new Error('Opening probability must be between 2% and 98%.')
  if (typeof d.probabilitySource !== 'string' || d.probabilitySource.length > 1000) throw new Error('Invalid probability source.')
  if (d.openingProbability !== null && d.probabilitySource.trim().length < 5) throw new Error('Explain the source of the opening probability.')
  return { ...initial, title: d.title.trim(), rules: d.rules.trim(), category: d.category,
    matchId: d.matchId, closesAt: d.closesAt, openingProbability: d.openingProbability,
    probabilitySource: d.probabilitySource.trim(), updatedAt: new Date().toISOString() }
}
export type MatchCandidate = {
  id: string; title: string; category: string; round: string; scheduledAt: string | null
  probability: number | null; status: string; completePair: boolean
}
export function matchReady(m: MatchCandidate, now = Date.now()): boolean {
  return MAIN_DRAW_ROUNDS.includes(m.round) && m.status === 'scheduled' && m.completePair
    && m.scheduledAt !== null && Date.parse(m.scheduledAt) > now
}
export function draftBlockers(d: MarketDraft, matches: MatchCandidate[], now = Date.now()): string[] {
  const blockers: string[] = []
  if (d.kind === 'daily-match') {
    const match = matches.find(m => m.id === d.matchId)
    if (!match) blockers.push('Choose the daily match.')
    else if (!matchReady(match, now)) blockers.push('The match needs four known players and a future scheduled start.')
  }
  if (d.kind !== 'daily-match' && (!d.closesAt || Date.parse(d.closesAt) <= now)) blockers.push('Set a future deadline.')
  if (d.openingProbability === null) blockers.push('Set an opening probability with its source.')
  if (d.kind === 'tournament-bagel') blockers.push('Tournament score coverage, forecast updates and early trade locking must be connected before opening.')
  if (d.kind === 'partnership') blockers.push('Standalone markets and an official-evidence review workflow must be connected before opening.')
  return blockers
}
