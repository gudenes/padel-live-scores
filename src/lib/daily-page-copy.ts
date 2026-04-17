// src/lib/daily-page-copy.ts
// Pure functions that build localised prose for the /matches/[date] page.
//
// Google ranks daily pages on more than a match list — they need an intro
// paragraph and FAQ so crawlers treat them as editorial, not thin scrape.
// These functions are deterministic (same input → same output), so the
// copy is stable across renders and easy to cache/test.

export type MatchStatus = 'live' | 'scheduled' | 'finished' | 'retired' | 'walkover'

export interface DailyMatchSummary {
  status: MatchStatus
  /** Kickoff in UTC, ISO string. */
  scheduledAt: string | null
  tournament: {
    name: string
    level?: string | null
  } | null
  featuredPlayer?: {
    name: string
    ranking?: number | null
  } | null
}

export interface BuildDailyCopyInput {
  /** YYYY-MM-DD in the locale's home timezone. */
  iso: string
  /** UI locale code — matches against the localised phrase map. */
  locale: string
  /** Human-readable date, already localised by the caller (e.g. "17 de abril de 2026"). */
  dateLong: string
  /** All matches on this day in the locale's home timezone. */
  matches: DailyMatchSummary[]
}

export interface DailyIntroResult {
  h1: string
  lead: string
}

export interface DailyFaqItem {
  q: string
  a: string
}

// ─────────────────────────────────────────────────────────────────────
// Phrase maps — keep copy data-driven so translations live in one place.
// Strings intentionally duplicated (not pulled from next-intl) because
// these functions run server-side during SSR and must be deterministic
// without an active next-intl request scope.
// ─────────────────────────────────────────────────────────────────────

type Phrases = {
  h1WithCount: (date: string, n: number) => string
  h1NoMatches: (date: string) => string
  leadFeatured: (n: number, events: string, player: string) => string
  leadNoFeature: (n: number, events: string) => string
  leadNoMatches: (date: string) => string
  leadMultiEventsJoiner: string
  faqCount: { q: string; a: (n: number) => string }
  faqFeatured: { q: (player: string) => string; a: (player: string, events: string) => string }
  faqEvents: { q: string; a: (events: string) => string }
  faqLive: { q: string; a: string }
}

const PHRASES: Record<string, Phrases> = {
  en: {
    h1WithCount: (d, n) => `Padel matches today — ${d} (${n} matches)`,
    h1NoMatches: (d) => `Padel schedule — ${d}`,
    leadFeatured: (n, events, player) =>
      `${n} padel matches on the schedule today at ${events}, headlined by ${player}. Live scores update in real time throughout the day.`,
    leadNoFeature: (n, events) =>
      `${n} padel matches on the schedule today at ${events}. Follow live scores, results and times below — updated in real time.`,
    leadNoMatches: (d) =>
      `No professional padel matches on the schedule for ${d}. Check yesterday's results or tomorrow's schedule using the date picker below.`,
    leadMultiEventsJoiner: ' and ',
    faqCount: {
      q: 'How many padel matches are there today?',
      a: (n) => n === 0
        ? 'No professional padel matches are scheduled today.'
        : `There are ${n} professional padel matches scheduled today across Premier Padel and FIP events.`,
    },
    faqFeatured: {
      q: (p) => `When does ${p} play today?`,
      a: (p, events) => `${p} is scheduled to play today at ${events}. Exact start times update in real time — see the schedule above for the latest.`,
    },
    faqEvents: {
      q: 'Which padel tournaments are playing today?',
      a: (events) => `Today's action is at ${events}. Each event card below links to the full tournament schedule, draw and results.`,
    },
    faqLive: {
      q: 'Can I watch today\'s padel matches live?',
      a: 'Live scores on this page update point by point. For official video broadcasts check the tournament\'s page or the Premier Padel and FIP official channels.',
    },
  },

  es: {
    h1WithCount: (d, n) => `Partidos de pádel hoy — ${d} (${n} partidos)`,
    h1NoMatches: (d) => `Calendario de pádel — ${d}`,
    leadFeatured: (n, events, player) =>
      `${n} partidos de pádel en el calendario de hoy en ${events}, con ${player} como gran atractivo. Los resultados se actualizan en directo a lo largo del día.`,
    leadNoFeature: (n, events) =>
      `${n} partidos de pádel en el calendario de hoy en ${events}. Sigue los resultados, horarios y marcadores en directo más abajo.`,
    leadNoMatches: (d) =>
      `No hay partidos profesionales de pádel en el calendario del ${d}. Consulta los resultados de ayer o los partidos de mañana con el selector de fechas.`,
    leadMultiEventsJoiner: ' y ',
    faqCount: {
      q: '¿Cuántos partidos de pádel se juegan hoy?',
      a: (n) => n === 0
        ? 'Hoy no hay partidos profesionales de pádel programados.'
        : `Hoy se juegan ${n} partidos profesionales de pádel entre Premier Padel y FIP.`,
    },
    faqFeatured: {
      q: (p) => `¿A qué hora juega ${p} hoy?`,
      a: (p, events) => `${p} tiene partido hoy en ${events}. Los horarios exactos se actualizan en tiempo real — consulta el calendario superior para ver la última hora.`,
    },
    faqEvents: {
      q: '¿Qué torneos de pádel se juegan hoy?',
      a: (events) => `Hoy se juega en ${events}. Cada evento enlaza a su calendario completo, cuadro y resultados.`,
    },
    faqLive: {
      q: '¿Se pueden ver los partidos de hoy en directo?',
      a: 'Los marcadores en esta página se actualizan punto a punto. Para la retransmisión oficial, consulta la página del torneo o los canales oficiales de Premier Padel y FIP.',
    },
  },

  pt: {
    h1WithCount: (d, n) => `Jogos de padel hoje — ${d} (${n} partidas)`,
    h1NoMatches: (d) => `Calendário de padel — ${d}`,
    leadFeatured: (n, events, player) =>
      `${n} jogos de padel no calendário de hoje em ${events}, com destaque para ${player}. O placar é atualizado ao vivo ao longo do dia.`,
    leadNoFeature: (n, events) =>
      `${n} jogos de padel no calendário de hoje em ${events}. Acompanhe resultados, horários e placar ao vivo abaixo.`,
    leadNoMatches: (d) =>
      `Não há jogos profissionais de padel no calendário de ${d}. Veja os resultados de ontem ou os jogos de amanhã pelo seletor de datas abaixo.`,
    leadMultiEventsJoiner: ' e ',
    faqCount: {
      q: 'Quantos jogos de padel acontecem hoje?',
      a: (n) => n === 0
        ? 'Hoje não há partidas profissionais de padel no calendário.'
        : `Hoje há ${n} partidas profissionais de padel entre Premier Padel e FIP.`,
    },
    faqFeatured: {
      q: (p) => `A que horas ${p} joga hoje?`,
      a: (p, events) => `${p} joga hoje em ${events}. Os horários exatos são atualizados em tempo real — confira o calendário acima para o último horário.`,
    },
    faqEvents: {
      q: 'Que torneios de padel estão acontecendo hoje?',
      a: (events) => `Hoje se joga em ${events}. Cada evento leva ao calendário completo, chaveamento e resultados.`,
    },
    faqLive: {
      q: 'É possível assistir aos jogos de padel de hoje ao vivo?',
      a: 'O placar nesta página é atualizado ponto a ponto. Para transmissão oficial, veja a página do torneio ou os canais oficiais da Premier Padel e FIP.',
    },
  },

  it: {
    h1WithCount: (d, n) => `Partite di padel oggi — ${d} (${n} partite)`,
    h1NoMatches: (d) => `Calendario padel — ${d}`,
    leadFeatured: (n, events, player) =>
      `${n} partite di padel in programma oggi a ${events}, con ${player} come grande protagonista. I risultati vengono aggiornati in diretta durante tutta la giornata.`,
    leadNoFeature: (n, events) =>
      `${n} partite di padel in programma oggi a ${events}. Segui risultati, orari e punteggi in diretta qui sotto.`,
    leadNoMatches: (d) =>
      `Nessuna partita professionistica di padel in programma il ${d}. Controlla i risultati di ieri o le partite di domani con il selettore di date.`,
    leadMultiEventsJoiner: ' e ',
    faqCount: {
      q: 'Quante partite di padel si giocano oggi?',
      a: (n) => n === 0
        ? 'Oggi non ci sono partite professionistiche di padel in programma.'
        : `Oggi si giocano ${n} partite professionistiche di padel tra Premier Padel e FIP.`,
    },
    faqFeatured: {
      q: (p) => `A che ora gioca ${p} oggi?`,
      a: (p, events) => `${p} è in programma oggi a ${events}. Gli orari esatti si aggiornano in tempo reale — consulta il calendario sopra per l'orario aggiornato.`,
    },
    faqEvents: {
      q: 'Quali tornei di padel si giocano oggi?',
      a: (events) => `Oggi si gioca a ${events}. Ogni evento porta al calendario completo, tabellone e risultati.`,
    },
    faqLive: {
      q: 'Si possono vedere le partite di padel di oggi in diretta?',
      a: 'I punteggi in questa pagina si aggiornano punto per punto. Per la trasmissione ufficiale, consulta la pagina del torneo o i canali ufficiali Premier Padel e FIP.',
    },
  },

  fr: {
    h1WithCount: (d, n) => `Matchs de padel aujourd'hui — ${d} (${n} matchs)`,
    h1NoMatches: (d) => `Calendrier padel — ${d}`,
    leadFeatured: (n, events, player) =>
      `${n} matchs de padel au programme aujourd'hui à ${events}, avec ${player} en vedette. Les scores sont mis à jour en direct tout au long de la journée.`,
    leadNoFeature: (n, events) =>
      `${n} matchs de padel au programme aujourd'hui à ${events}. Suivez résultats, horaires et scores en direct ci-dessous.`,
    leadNoMatches: (d) =>
      `Aucun match professionnel de padel au programme le ${d}. Consultez les résultats d'hier ou les matchs de demain avec le sélecteur de date.`,
    leadMultiEventsJoiner: ' et ',
    faqCount: {
      q: 'Combien de matchs de padel se jouent aujourd\'hui ?',
      a: (n) => n === 0
        ? 'Aucun match professionnel de padel n\'est programmé aujourd\'hui.'
        : `Il y a aujourd'hui ${n} matchs professionnels de padel entre Premier Padel et FIP.`,
    },
    faqFeatured: {
      q: (p) => `À quelle heure joue ${p} aujourd'hui ?`,
      a: (p, events) => `${p} joue aujourd'hui à ${events}. Les horaires exacts sont mis à jour en temps réel — consultez le calendrier ci-dessus pour l'heure actualisée.`,
    },
    faqEvents: {
      q: 'Quels tournois de padel se jouent aujourd\'hui ?',
      a: (events) => `Le padel se joue aujourd'hui à ${events}. Chaque événement mène au calendrier complet, tableau et résultats.`,
    },
    faqLive: {
      q: 'Peut-on regarder les matchs de padel d\'aujourd\'hui en direct ?',
      a: 'Les scores sur cette page sont mis à jour point par point. Pour la retransmission officielle, consultez la page du tournoi ou les chaînes officielles Premier Padel et FIP.',
    },
  },
}

function phrasesFor(locale: string): Phrases {
  return PHRASES[locale] ?? PHRASES.en
}

/** Returns the unique, ordered list of tournament names on the day. */
function uniqueEventNames(matches: DailyMatchSummary[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const name = m.tournament?.name
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** "A, B and C" — respects locale joiner for the final pair. */
function joinNames(names: string[], joiner: string): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return names[0] + joiner + names[1]
  return names.slice(0, -1).join(', ') + joiner + names[names.length - 1]
}

/**
 * Picks the "featured" player of the day — defaulting to the highest-ranked
 * player found on any match's featuredPlayer annotation. Returns null when
 * no match has a featured player or none have a ranking.
 */
function pickFeaturedPlayer(matches: DailyMatchSummary[]): string | null {
  let best: { name: string; ranking: number } | null = null
  for (const m of matches) {
    const fp = m.featuredPlayer
    if (!fp || !fp.name || fp.ranking == null) continue
    if (!best || fp.ranking < best.ranking) {
      best = { name: fp.name, ranking: fp.ranking }
    }
  }
  return best?.name ?? null
}

/** Generates the H1 + lead paragraph for the daily page. */
export function buildDailyIntro(input: BuildDailyCopyInput): DailyIntroResult {
  const p = phrasesFor(input.locale)
  const n = input.matches.length
  const events = uniqueEventNames(input.matches)
  const eventsText = joinNames(events, p.leadMultiEventsJoiner)
  const player = pickFeaturedPlayer(input.matches)

  if (n === 0) {
    return {
      h1: p.h1NoMatches(input.dateLong),
      lead: p.leadNoMatches(input.dateLong),
    }
  }

  const lead = player
    ? p.leadFeatured(n, eventsText, player)
    : p.leadNoFeature(n, eventsText)

  return {
    h1: p.h1WithCount(input.dateLong, n),
    lead,
  }
}

/**
 * Generates 3–4 FAQ items for the daily page. The FAQ block is also rendered
 * as FAQPage JSON-LD so Google can show rich results.
 */
export function buildDailyFaq(input: BuildDailyCopyInput): DailyFaqItem[] {
  const p = phrasesFor(input.locale)
  const n = input.matches.length
  const events = uniqueEventNames(input.matches)
  const eventsText = joinNames(events, p.leadMultiEventsJoiner)
  const player = pickFeaturedPlayer(input.matches)

  const out: DailyFaqItem[] = [
    { q: p.faqCount.q, a: p.faqCount.a(n) },
  ]

  if (player && events.length > 0) {
    out.push({ q: p.faqFeatured.q(player), a: p.faqFeatured.a(player, eventsText) })
  }
  if (events.length > 0) {
    out.push({ q: p.faqEvents.q, a: p.faqEvents.a(eventsText) })
  }
  out.push({ q: p.faqLive.q, a: p.faqLive.a })

  return out
}
