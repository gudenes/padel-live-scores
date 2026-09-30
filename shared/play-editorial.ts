/** Shared, versioned authoring contract. Resolver parameters are derived, never raw UI JSON. */
export const EDITORIAL_FAMILIES = {
  round: { label: 'Reach a round', resolver: 'tournament.pair_reaches_round_v1', horizon: 'tournament' },
  other_champion: { label: 'Another pair wins', resolver: 'tournament.other_pair_wins_v1', horizon: 'tournament' },
  titles: { label: 'Win a number of titles', resolver: 'season.pair_title_count_v1', horizon: 'season' },
  ranking: { label: 'Reach an official ranking', resolver: 'player.reaches_ranking_v1', horizon: 'season' },
} as const
export type EditorialFamily = keyof typeof EDITORIAL_FAMILIES
export interface EditorialConfig {
  family: EditorialFamily; category: 'men' | 'women'; playerIds: string[]; tournamentIds: string[];
  round: 'SF' | 'F'; target: number; minimumStarts: number;
  startsAt: string; endsAt: string; locksAt: string; voidAfter: string;
  probability: number | null; probabilitySource: string; maxLoss: number;
}
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function validateEditorialConfig(raw: unknown): EditorialConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid market configuration.')
  const c = raw as EditorialConfig
  const keys = ['family','category','playerIds','tournamentIds','round','target','minimumStarts','startsAt','endsAt','locksAt','voidAfter','probability','probabilitySource','maxLoss']
  if (Object.keys(c).some(k => !keys.includes(k))) throw new Error('Unknown configuration field.')
  if (!Object.hasOwn(EDITORIAL_FAMILIES, c.family) || !['men','women'].includes(c.category)) throw new Error('Choose a template and draw.')
  for (const k of ['playerIds','tournamentIds'] as const) {
    if (!Array.isArray(c[k]) || c[k].some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(c[k]).size !== c[k].length) throw new Error('Choose distinct players and events.')
  }
  // Incomplete bindings may be saved as drafts; preview enforces completeness.
  if (c.playerIds.length > (c.family === 'ranking' ? 1 : 2) || c.tournamentIds.length > 12) throw new Error('Too many players or events.')
  if (!['SF','F'].includes(c.round)) throw new Error('Choose semifinal or final.')
  if (!Number.isInteger(c.target) || c.target < 1 || c.target > 500 || !Number.isInteger(c.minimumStarts) || c.minimumStarts < 1 || c.minimumStarts > 12) throw new Error('Invalid target or participation minimum.')
  for (const k of ['startsAt','endsAt','locksAt','voidAfter'] as const) {
    if (typeof c[k] !== 'string' || (c[k] !== '' && !Number.isFinite(Date.parse(c[k])))) throw new Error('Invalid date.')
  }
  if (c.probability !== null && (typeof c.probability !== 'number' || !Number.isFinite(c.probability) || c.probability < .02 || c.probability > .98)) throw new Error('Opening probability must be between 2% and 98%.')
  if (typeof c.probabilitySource !== 'string' || c.probabilitySource.length > 1000) throw new Error('Invalid probability source.')
  if (!Number.isInteger(c.maxLoss) || c.maxLoss < 100 || c.maxLoss > 50000) throw new Error('Subsidy must be 100–50,000 Guacas.')
  return { ...c, ...Object.fromEntries((['startsAt','endsAt','locksAt','voidAfter'] as const).map(k=>[k,c[k]?new Date(c[k]).toISOString():''])), playerIds: [...c.playerIds].sort(), tournamentIds: [...c.tournamentIds].sort(), probabilitySource: c.probabilitySource.trim() }
}
export function editorialBindingErrors(c: EditorialConfig, now: Date): string[] {
  const errors: string[] = []
  const tournament = c.family === 'round' || c.family === 'other_champion'
  if (c.playerIds.length !== (c.family === 'ranking' ? 1 : 2)) errors.push('Select every player.')
  if ((tournament && c.tournamentIds.length !== 1) || (c.family === 'titles' && !c.tournamentIds.length) || (c.family === 'ranking' && c.tournamentIds.length)) errors.push('Select the events required by this template.')
  if (c.family === 'titles' && (c.target > c.tournamentIds.length || c.minimumStarts > c.tournamentIds.length)) errors.push('Title/participation targets exceed the selected events.')
  if (!c.endsAt || !c.voidAfter || Date.parse(c.endsAt) >= Date.parse(c.voidAfter)) errors.push('Set an end date and a later refund deadline.')
  if (!tournament && (!c.startsAt || !c.locksAt || Date.parse(c.startsAt) >= Date.parse(c.endsAt) || Date.parse(c.locksAt) > Date.parse(c.startsAt) || Date.parse(c.locksAt) <= now.getTime())) errors.push('Trading must close before the future result window starts.')
  if (!tournament && (c.probability === null || c.probabilitySource.length < 10)) errors.push('Add a priced estimate and explain its source. No automatic long-term model is available.')
  return errors
}
export function editorialParams(c: EditorialConfig): Record<string, unknown> {
  const common = { voidAfter: c.voidAfter }
  if (c.family === 'ranking') return { ...common, playerId: c.playerIds[0], rank: c.target, startsAt: c.startsAt, endsAt: c.endsAt }
  const pair = { ...common, player1Id: c.playerIds[0], player2Id: c.playerIds[1] }
  if (c.family === 'round') return { ...pair, round: c.round }
  if (c.family === 'titles') return { ...pair, tournamentIds: c.tournamentIds, titles: c.target, minimumStarts: c.minimumStarts, endsAt: c.endsAt }
  return pair
}
export function editorialCopy(c: EditorialConfig, players: string[], events: string[]) {
  const pair = players.join(' / '), scope = events.join(', ')
  const date = c.endsAt.slice(0,10), until = c.voidAfter
  const question = c.family === 'round'
    ? { en: `Will ${pair} reach the ${c.round === 'SF' ? 'semifinals' : 'final'} in ${scope}?`, es: `¿Llegará ${pair} a ${c.round === 'SF' ? 'semifinales' : 'la final'} en ${scope}?` }
    : c.family === 'other_champion'
      ? { en: `Will a pair other than ${pair} win ${scope}?`, es: `¿Ganará ${scope} una pareja distinta de ${pair}?` }
      : c.family === 'titles'
        ? { en: `Will ${pair} win at least ${c.target} title(s) across ${scope}?`, es: `¿Ganará ${pair} al menos ${c.target} título(s) entre ${scope}?` }
        : { en: `Will ${pair} reach official No. ${c.target} or better by ${date}?`, es: `¿Alcanzará ${pair} el puesto ${c.target} o mejor del ranking oficial antes de finalizar el ${date}?` }
  const rules = c.family === 'round'
    ? { en: 'YES once this exact pair starts playing in the target round or a later round. NO after a confirmed defeat in an earlier main-draw round. A scheduled slot or walkover alone is not participation.', es: 'SÍ cuando esta pareja exacta empiece a jugar la ronda indicada o una posterior. NO tras una derrota confirmada en una ronda anterior del cuadro principal. Una plaza programada o un pase por incomparecencia no bastan.' }
    : c.family === 'other_champion'
      ? { en: 'YES if the confirmed final winner is another pair. NO if this exact pair wins. A retirement with an official final winner counts. An unplayed final without a confirmed played result remains unresolved.', es: 'SÍ si otra pareja gana la final confirmada. NO si gana esta pareja exacta. Cuenta una retirada con ganador oficial. Una final no disputada sin resultado confirmado queda pendiente.' }
      : c.family === 'titles'
        ? { en: `YES after ${c.target} confirmed titles for this exact pair in the listed events. NO only after ${c.endsAt}, with every final confirmed and at least ${c.minimumStarts} events played by the pair. Substitutes, qualifying and walkovers do not establish participation.`, es: `SÍ tras ${c.target} títulos confirmados de esta pareja exacta en los eventos indicados. NO solo después de ${c.endsAt}, con todas las finales confirmadas y al menos ${c.minimumStarts} eventos disputados. Suplentes, previa y pases por incomparecencia no acreditan participación.` }
        : { en: `Official FIP ranking only, from ${c.startsAt} through ${c.endsAt}. YES on any recorded rank of ${c.target} or better. NO requires every weekly Monday-labelled snapshot in the window.`, es: `Solo ranking oficial FIP, desde ${c.startsAt} hasta ${c.endsAt}. SÍ con cualquier puesto registrado ${c.target} o mejor. NO requiere todas las clasificaciones semanales del período, fechadas en lunes.` }
  return { question, rules: { en: `${rules.en} Missing/conflicting evidence is reviewed until ${until}; if still unresolved, all positions are refunded.`, es: `${rules.es} Los datos ausentes o contradictorios se revisan hasta ${until}; si no se resuelven, se reembolsan todas las posiciones.` } }
}
