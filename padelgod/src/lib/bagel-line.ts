// Tournament bagel LINE markets — planning and copy.
//
// One market per Premier event × category: "Will the women's main draw at
// Rotterdam have 3 or more 6-0 sets?". Settled by
// market-resolvers/bagel-count.ts.
//
// The line and opening price live in `market_templates.params.lines`, keyed by
// lowercase `tournaments.level` then category. They were calibrated from
// 2025-01 → 2026-09 completed main draws: the line is the threshold whose
// smoothed historical frequency, (k+1)/(n+2), lands closest to 50%. A level with
// no entry gets NO market — a guessed line would open at a price nobody can
// defend.

import { isMainDrawRound } from './market-resolvers/bagel-count.js'

export const BAGEL_LINE_RESOLVER = 'tournament.bagel_count_at_least_v1'

export const PLAY_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
export type PlayLocale = (typeof PLAY_LOCALES)[number]
export type Localized = Record<PlayLocale, string>

export interface BagelLine { line: number; seedProb: number }

export function lineFor(
  params: Record<string, unknown> | null | undefined,
  level: string | null,
  category: 'men' | 'women',
): BagelLine | null {
  if (!level) return null
  const lines = params?.lines as Record<string, Record<string, unknown>> | undefined
  const entry = lines?.[level.toLowerCase()]?.[category] as Record<string, unknown> | undefined
  if (!entry) return null
  const line = Number(entry.line)
  const seedProb = Number(entry.seedProb)
  if (!Number.isInteger(line) || line < 1) return null
  if (!Number.isFinite(seedProb) || seedProb <= 0 || seedProb >= 1) return null
  return { line, seedProb }
}

export interface DrawMatchRow {
  id: string
  tournament_id: string | null
  category: string | null
  round_canonical: string | null
  status: string | null
  scheduled_at: string | null
}

export interface BagelLinePlan {
  tournamentId: string
  tournamentName: string
  category: 'men' | 'women'
  line: number
  seedProb: number
  /** The draw's first main-draw match. The DB trigger
   *  `play_lock_started_markets` locks the market the moment it starts. */
  boundMatchId: string
  locksAt: Date
}

/**
 * Which draws get a line market right now.
 *
 * Only a draw whose main draw has NOT started: once one main-draw match is
 * under way the count is partly known, and a market opened then would be
 * selling an answer some traders can already see.
 */
export function planBagelLineMarkets(
  params: Record<string, unknown> | null | undefined,
  tournaments: { id: string; level: string | null; name: string | null }[],
  rows: DrawMatchRow[],
  now: Date,
): BagelLinePlan[] {
  const plans: BagelLinePlan[] = []
  for (const t of tournaments) {
    for (const category of ['men', 'women'] as const) {
      const line = lineFor(params, t.level, category)
      if (!line) continue

      const draw = rows.filter((r) =>
        r.tournament_id === t.id && r.category === category && isMainDrawRound(r.round_canonical))
      if (draw.length === 0) continue
      if (draw.some((r) => r.status !== 'scheduled')) continue

      let first: DrawMatchRow | null = null
      for (const r of draw) {
        if (!r.scheduled_at) continue
        if (!first || r.scheduled_at < first.scheduled_at!) first = r
      }
      if (!first) continue
      const locksAt = new Date(first.scheduled_at!)
      if (!(locksAt > now)) continue

      plans.push({
        tournamentId: t.id,
        tournamentName: t.name ?? '',
        category,
        line: line.line,
        seedProb: line.seedProb,
        boundMatchId: first.id,
        locksAt,
      })
    }
  }
  return plans
}

const DRAW: Record<PlayLocale, Record<'men' | 'women', string>> = {
  en: { men: "men's", women: "women's" },
  es: { men: 'masculino', women: 'femenino' },
  pt: { men: 'masculino', women: 'feminino' },
  it: { men: 'maschile', women: 'femminile' },
  fr: { men: 'masculin', women: 'féminin' },
}

/**
 * Question + rules in every app locale, fully rendered. Written to the
 * market's `question_snapshot` / `rules_snapshot`, which the definition-freeze
 * trigger then makes immutable — so this is the contract text the market is
 * judged by, in each language.
 */
export function bagelLineCopy(input: {
  tournamentName: string
  category: 'men' | 'women'
  line: number
}): { question: Localized; rules: Localized } {
  const { tournamentName: t, category: c, line: n } = input
  const d = (l: PlayLocale) => DRAW[l][c]
  return {
    question: {
      en: `Will the ${d('en')} main draw at ${t} have ${n} or more 6-0 sets?`,
      es: `¿Habrá ${n} o más sets 6-0 en el cuadro principal ${d('es')} de ${t}?`,
      pt: `Haverá ${n} ou mais sets 6-0 no quadro principal ${d('pt')} de ${t}?`,
      it: `Ci saranno ${n} o più set finiti 6-0 nel tabellone principale ${d('it')} di ${t}?`,
      fr: `Y aura-t-il ${n} sets 6-0 ou plus dans le tableau principal ${d('fr')} de ${t} ?`,
    },
    rules: {
      en: `Counts every set that finished 6-0, by either pair, in main-draw matches of the ${d('en')} draw. Qualifying does not count. Sets already played in a retired match count; sets never played do not. YES as soon as completed matches reach ${n}. NO once every main-draw match, the final included, is over with fewer than ${n}. Trading closes when the first main-draw match starts.`,
      es: `Cuenta cada set terminado 6-0, por cualquiera de las dos parejas, en los partidos del cuadro principal ${d('es')}. La previa no cuenta. Los sets ya jugados en un partido con retirada cuentan; los no disputados, no. SÍ en cuanto los partidos terminados lleguen a ${n}. NO cuando todos los partidos del cuadro principal, final incluida, hayan terminado con menos de ${n}. Las operaciones se cierran al empezar el primer partido del cuadro principal.`,
      pt: `Conta cada set terminado em 6-0, por qualquer das duplas, nos jogos do quadro principal ${d('pt')}. O qualifying não conta. Sets já jogados num jogo com desistência contam; sets não disputados, não. SIM assim que os jogos terminados chegarem a ${n}. NÃO quando todos os jogos do quadro principal, incluindo a final, terminarem com menos de ${n}. As negociações fecham quando começa o primeiro jogo do quadro principal.`,
      it: `Conta ogni set finito 6-0, da una qualsiasi delle due coppie, nelle partite del tabellone principale ${d('it')}. Le qualificazioni non contano. I set già giocati in una partita con ritiro contano; quelli mai disputati no. SÌ appena le partite concluse arrivano a ${n}. NO quando tutte le partite del tabellone principale, finale compresa, sono concluse con meno di ${n}. Le operazioni si chiudono all'inizio della prima partita del tabellone principale.`,
      fr: `Compte chaque set terminé 6-0, par l'une ou l'autre paire, dans les matchs du tableau principal ${d('fr')}. Les qualifications ne comptent pas. Les sets déjà joués dans un match abandonné comptent ; les sets jamais disputés, non. OUI dès que les matchs terminés atteignent ${n}. NON lorsque tous les matchs du tableau principal, finale comprise, sont terminés avec moins de ${n}. Les échanges ferment au début du premier match du tableau principal.`,
    },
  }
}
