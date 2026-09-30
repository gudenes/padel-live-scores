/** User shortlist from Market Queue column L, 29 September 2026.
 * Definitions only. Publishing must bind player IDs, prices and fresh deadlines.
 */
export const SELECTED_BETA_MARKETS = [
  { sheetId: 23, key: 'rotterdam-lebron-augsburger-semifinal', category: 'men',
    players: ['Juan Lebrón', 'Leo Augsburger'], resolverKey: 'tournament.pair_reaches_round_v1',
    question: { en: 'Will Lebrón / Augsburger reach the Rotterdam semifinals?', es: '¿Llegarán Lebrón / Augsburger a semifinales en Róterdam?' },
    params: { round: 'SF' }, scope: 'rotterdam' },
  { sheetId: 24, key: 'rotterdam-josemaria-gonzalez-final', category: 'women',
    players: ['Paula Josemaría', 'Bea González'], resolverKey: 'tournament.pair_reaches_round_v1',
    question: { en: 'Will Josemaría / González reach the Rotterdam final?', es: '¿Llegarán Josemaría / González a la final de Róterdam?' },
    params: { round: 'F' }, scope: 'rotterdam' },
  { sheetId: 25, key: 'rotterdam-calvo-fernandez-final', category: 'women',
    players: ['Martina Calvo', 'Claudia Fernández'], resolverKey: 'tournament.pair_reaches_round_v1',
    question: { en: 'Will Calvo / Fernández reach the Rotterdam final?', es: '¿Llegarán Calvo / Fernández a la final de Róterdam?' },
    params: { round: 'F' }, scope: 'rotterdam' },
  { sheetId: 26, key: 'rotterdam-other-champion', category: 'men',
    players: ['Arturo Coello', 'Agustín Tapia'], resolverKey: 'tournament.other_pair_wins_v1',
    question: { en: 'Will a pair other than Coello / Tapia win Rotterdam?', es: '¿Ganará Róterdam una pareja distinta de Coello / Tapia?' },
    params: {}, scope: 'rotterdam' },
  { sheetId: 29, key: 'coello-tapia-two-titles', category: 'men',
    players: ['Arturo Coello', 'Agustín Tapia'], resolverKey: 'season.pair_title_count_v1',
    question: { en: 'Will Coello / Tapia win at least two of Germany, Milano and Mexico?', es: '¿Ganarán Coello / Tapia al menos dos títulos entre Alemania, Milán y México?' },
    params: { titles: 2, minimumStarts: 3 }, scope: 'germany-milano-mexico' },
  { sheetId: 30, key: 'lebron-augsburger-autumn-title', category: 'men',
    players: ['Juan Lebrón', 'Leo Augsburger'], resolverKey: 'season.pair_title_count_v1',
    question: { en: 'Will Lebrón / Augsburger win a Premier title in October or November?', es: '¿Ganarán Lebrón / Augsburger un título de Premier en octubre o noviembre?' },
    params: { titles: 1, minimumStarts: 2 }, scope: 'premier-october-november' },
  { sheetId: 37, key: 'javi-leal-top-twelve', category: 'men',
    players: ['Javi Leal'], resolverKey: 'player.reaches_ranking_v1',
    question: { en: 'Will Javi Leal reach official No. 12 or better by 30 November?', es: '¿Alcanzará Javi Leal el puesto 12 o mejor del ranking oficial antes de finalizar el 30 de noviembre?' },
    params: { rank: 12, startsAt: '2026-10-01T00:00:00Z' }, scope: 'official-ranking-october-november' },
] as const

export const BETA_LONG_TERM_LOCK = '2026-10-01T00:00:00Z'
export const BETA_LONG_TERM_END = '2026-11-30T23:59:59Z'
export const BETA_REVIEW_DEADLINE = '2026-12-08T00:00:00Z'

/** Publication must not turn definitions or old projection snapshots into live prices. */
export function publicationBlockers(input: {
  locksAt: string; now: Date; playerIds: string[]; expectedPlayers: number;
  probability: number | null; probabilitySource: string;
  scopeVerified: boolean; outcomeAlreadyKnown: boolean; remainingCapacity: number;
}): string[] {
  const reasons: string[] = []
  if (!Number.isFinite(Date.parse(input.locksAt)) || Date.parse(input.locksAt) <= input.now.getTime()) reasons.push('Closing time must be in the future.')
  if (input.playerIds.length !== input.expectedPlayers || new Set(input.playerIds).size !== input.expectedPlayers || input.playerIds.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) reasons.push('Bind verified, distinct player IDs.')
  if (input.probability === null || !Number.isFinite(input.probability) || input.probability < .02 || input.probability > .98 || !input.probabilitySource.trim()) reasons.push('Supply a current opening probability and its source.')
  if (!input.scopeVerified) reasons.push('Verify the complete event or official ranking scope.')
  if (input.outcomeAlreadyKnown) reasons.push('The outcome is already known; do not publish.')
  if (!Number.isInteger(input.remainingCapacity) || input.remainingCapacity < 1) reasons.push('No market capacity is available.')
  return reasons
}

// Matched to the current FIP calendar on 29 September 2026, not the older PDF.
// https://www.padelfip.com/es/calendario-premier-padel/?events-year=2026
export const VERIFIED_BETA_EVENTS = {
  rotterdam: 'f5975267-7748-4a6a-9e21-3498ec0f04a5',
  germany: '9ba1b209-c4b2-4042-a614-e35513fd55a5',
  milano: '53a86546-7a07-4b15-9534-56bea2e42dce',
  kuwait: '38ec2aca-38e2-42a6-8353-ece5f7a8a561',
  dubai: '9f50b503-24e1-4f75-b742-3f21679a24da',
  mexico: 'c858f931-48a5-4ab5-89a8-931c8be0b4f1',
} as const
export const BETA_TITLE_SCOPES = {
  'germany-milano-mexico': [VERIFIED_BETA_EVENTS.germany, VERIFIED_BETA_EVENTS.milano, VERIFIED_BETA_EVENTS.mexico],
  'premier-october-november': [VERIFIED_BETA_EVENTS.germany, VERIFIED_BETA_EVENTS.milano, VERIFIED_BETA_EVENTS.kuwait, VERIFIED_BETA_EVENTS.dubai, VERIFIED_BETA_EVENTS.mexico],
} as const
