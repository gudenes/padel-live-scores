import { describe, expect, it } from 'vitest'
import {
  describeMarket,
  num,
  parseLocale,
  positionValue,
  sidePrice,
  type MarketRow,
  type PlayerJoin,
} from './_shared'
import { bFromMaxLoss, seedShares, quoteBuy, quoteSell, priceYes } from '@/lib/lmsr'

const b = bFromMaxLoss(12000)
const seeded = seedShares(0.62, b)

function mkMarket(over: Partial<MarketRow> = {}): MarketRow {
  return {
    id: 'm1',
    public_id: 'abc123',
    season_id: 's1',
    template_id: 't1',
    match_id: 'match1',
    tournament_id: null,
    category: 'men',
    tokens: {},
    resolver_params: { pair: 1 },
    lmsr_b: String(b),
    seed_prob: '0.6200',
    seed_source: 'elo',
    q_yes: String(seeded.qYes),
    q_no: String(seeded.qNo),
    volume_guacas: '0',
    position_count: 0,
    status: 'open',
    locks_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
    outcome: null,
    template: {
      question_i18n: { en: 'Will {pair1} win this match?', es: '¿Ganará {pair1} este partido?' },
      horizon: 'pre-match',
    },
    match: {
      id: 'match1',
      status: 'scheduled',
      round: 'Semifinals',
      scheduled_at: null,
      category: 'men',
      pred_pair1_prob: '0.6400',
      pair1_player1_name: null,
      pair1_player2_name: null,
      pair2_player1_name: null,
      pair2_player2_name: null,
      pair1_player1: { name: 'Arturo Coello', display_name: null },
      pair1_player2: { name: 'Agustin Tapia', display_name: null },
      pair2_player1: { name: 'Alejandro Galan', display_name: null },
      pair2_player2: { name: 'Federico Chingotto', display_name: null },
      tournament: { name: 'Madrid P1', level: 'p1' },
    },
    tournament: null,
    ...over,
  }
}

describe('describeMarket', () => {
  it('localizes the context line (category + round) for every app locale', () => {
    expect(describeMarket(mkMarket(), 'es').context).toBe('Madrid P1 · Masculino · Semifinal')
    expect(describeMarket(mkMarket(), 'pt').context).toBe('Madrid P1 · Masculino · Semifinal')
    expect(describeMarket(mkMarket(), 'it').context).toBe('Madrid P1 · Maschile · Semifinale')
    expect(describeMarket(mkMarket(), 'fr').context).toBe('Madrid P1 · Hommes · Demi-finale')
  })

  it('renders question, context, subtitle, monogram from joined players', () => {
    const v = describeMarket(mkMarket(), 'en')
    expect(v.question).toBe('Will Coello / Tapia win this match?')
    expect(v.context).toBe('Madrid P1 · Men · Semifinal')
    expect(v.subtitle).toBe('Coello / Tapia vs Galan / Chingotto')
    expect(v.monogram).toEqual({ a: 'CT', b: 'GC' })
    expect(v.priceYes).toBeCloseTo(0.62, 6)
    expect(v.modelProb).toBeCloseTo(0.64, 6)
    expect(v.live).toBe(false)
    expect(v.stateLabel).toBeNull()
  })

  it('localises and prefers markets.tokens when the generator populates it', () => {
    const es = describeMarket(mkMarket(), 'es')
    expect(es.question).toBe('¿Ganará Coello / Tapia este partido?')
    const tok = describeMarket(mkMarket({ tokens: { pair1: 'Los Guapos' } }), 'en')
    expect(tok.question).toBe('Will Los Guapos win this match?')
  })

  it('degrades without rendering "?" or leaking template syntax', () => {
    const v = describeMarket(
      mkMarket({
        match: {
          ...mkMarket().match!,
          pair1_player1: null, pair1_player2: null,
          pair2_player1: null, pair2_player2: null,
        },
      }),
      'en',
    )
    expect(v.question).toBe('Will Pair 1 win this match?')
    expect(v.subtitle).toBe('Pair 1 vs Pair 2')
    expect(v.monogram).toEqual({ a: 'P1', b: 'P2' })
    expect(v.question).not.toContain('{')
    expect(v.question).not.toContain('?w')
  })

  it('falls back to the denormalised *_name columns when the FK is null', () => {
    const m = mkMarket()
    const v = describeMarket(
      mkMarket({
        match: {
          ...m.match!,
          pair1_player1: null,
          pair1_player1_name: 'Arturo Coello',
        },
      }),
      'en',
    )
    expect(v.question).toBe('Will Coello / Tapia win this match?')
  })

  it('complements pred_pair1_prob when the template asks about pair 2', () => {
    const v = describeMarket(mkMarket({ resolver_params: { pair: 2 } }), 'en')
    expect(v.modelProb).toBeCloseTo(0.36, 6)
  })

  // The card paints YES in the subject pair's colour and NO in the other's.
  // If subjectPair and modelProb ever read resolver_params differently, a
  // pair-2 market would show the orange block against the lime pair's faces.
  it('reports which pair the question is about, and agrees with modelProb', () => {
    const one = describeMarket(mkMarket({ resolver_params: { pair: 1 } }), 'en')
    expect(one.subjectPair).toBe(1)
    expect(one.modelProb).toBeCloseTo(0.64, 6)

    const two = describeMarket(mkMarket({ resolver_params: { pair: 2 } }), 'en')
    expect(two.subjectPair).toBe(2)
    expect(two.modelProb).toBeCloseTo(0.36, 6)
  })

  it('treats a missing or unreadable resolver_params.pair as pair 1', () => {
    // The generator writes resolver_params for every row it creates, but the
    // column is nullable and a malformed value must not silently flip a
    // market's colours. Defaulting is the only safe reading.
    expect(describeMarket(mkMarket({ resolver_params: null }), 'en').subjectPair).toBe(1)
    expect(describeMarket(mkMarket({ resolver_params: {} }), 'en').subjectPair).toBe(1)
    // '2' as a string is NOT 2 — resolver_params is jsonb and the generator
    // writes a number; a string would be a different bug, not a pair-2 market.
    expect(describeMarket(mkMarket({ resolver_params: { pair: '2' } }), 'en').subjectPair).toBe(1)
  })

  it('flags live and imminent-lock states distinctly', () => {
    const live = describeMarket(
      mkMarket({ match: { ...mkMarket().match!, status: 'on_court' } }), 'en')
    expect(live.live).toBe(true)
    expect(live.stateLabel).toBe('Live now')

    const soon = describeMarket(
      mkMarket({ locks_at: new Date(Date.now() + 10 * 60_000).toISOString() }), 'en')
    expect(soon.live).toBe(false)
    expect(soon.stateLabel).toBe('Starting soon')
  })

  it('uses the direct tournament FK for tournament-horizon markets', () => {
    const v = describeMarket(
      mkMarket({
        match_id: null, match: null,
        tournament_id: 'tour1', tournament: { name: 'Madrid P1', level: 'p1' },
        template: { question_i18n: { en: 'Will {pair1} win {tournament}?' }, horizon: 'tournament' },
        tokens: { pair1: 'Coello / Tapia' },
      }),
      'en',
    )
    expect(v.question).toBe('Will Coello / Tapia win Madrid P1?')
    expect(v.context).toBe('Madrid P1 · Men')
    expect(v.modelProb).toBeCloseTo(0.62, 6) // falls back to seed_prob
  })
})

// A set-shape market ("will any set finish 6-0") sits on an ordinary match that
// DOES carry a pred_pair1_prob. Without the seed_source check, the card would
// print the favourite's chance of winning the match under a "model" label — a
// real number answering a question nobody asked.
describe('describeMarket · fixed-seed markets show a base rate, never a model', () => {
  function bagel() {
    return mkMarket({
      seed_source: 'fixed',
      seed_prob: '0.2030',
      resolver_params: { seedProb: 0.203 },
      template: { question_i18n: { en: 'Will any set finish 6-0?' }, horizon: 'pre-match' },
    })
  }

  it('reports no model probability even though the match carries a prediction', () => {
    const v = describeMarket(bagel(), 'en')
    expect(v.modelProb).toBeNull()
    // The match's 0.64 must not leak through under any label.
    expect(v.baselineProb).not.toBeCloseTo(0.64, 2)
  })

  it('exposes the frozen seed as the historical baseline', () => {
    expect(describeMarket(bagel(), 'en').baselineProb).toBeCloseTo(0.203, 6)
  })

  it('leaves baselineProb null on an elo market', () => {
    const v = describeMarket(mkMarket(), 'en')
    expect(v.baselineProb).toBeNull()
    expect(v.modelProb).toBeCloseTo(0.64, 6)
  })

  it('keeps the two mutually exclusive', () => {
    for (const row of [mkMarket(), bagel()]) {
      const v = describeMarket(row, 'en')
      expect(v.modelProb === null).not.toBe(v.baselineProb === null)
    }
  })

  it('still prices, locks and renders the card normally', () => {
    const v = describeMarket(bagel(), 'en')
    expect(v.question).toBe('Will any set finish 6-0?')
    expect(v.priceYes).toBeCloseTo(0.62, 6) // from live LMSR state, not the seed
    expect(v.subtitle).toBe('Coello / Tapia vs Galan / Chingotto')
  })
})

describe('describeMarket · player identity', () => {
  /** mkMarket with the four embeds carrying real identity columns. */
  function withIdentity(over: Partial<PlayerJoin>[] = []): MarketRow {
    const base = mkMarket()
    const slot = (i: number, name: string, extra: Partial<PlayerJoin>): PlayerJoin => ({
      name,
      display_name: null,
      id: `p${i}`,
      country: 'ES',
      ranking: 10 + i,
      race_ranking: 20 + i,
      win_rate: 60,
      total_matches: 100,
      titles: 2,
      avatar_url: `https://example.test/${i}.png`,
      ...extra,
    })
    return mkMarket({
      match: {
        ...base.match!,
        pair1_player1_id: 'p0', pair1_player2_id: 'p1',
        pair2_player1_id: 'p2', pair2_player2_id: 'p3',
        pair1_player1: slot(0, 'Arturo Coello', over[0] ?? {}),
        pair1_player2: slot(1, 'Agustin Tapia', over[1] ?? {}),
        pair2_player1: slot(2, 'Alejandro Galan', over[2] ?? {}),
        pair2_player2: slot(3, 'Federico Chingotto', over[3] ?? {}),
      },
    })
  }

  it('splits the four players into pairs with their identity columns', () => {
    const v = describeMarket(withIdentity(), 'en')
    expect(v.players?.pair1.map((p) => p.surname)).toEqual(['Coello', 'Tapia'])
    expect(v.players?.pair2.map((p) => p.surname)).toEqual(['Galan', 'Chingotto'])
    const p = v.players!.pair1[0]!
    expect(p).toMatchObject({
      id: 'p0', name: 'Arturo Coello', country: 'ES', ranking: 10, raceRanking: 20,
      winRate: 60, totalMatches: 100, titles: 2, avatarUrl: 'https://example.test/0.png',
    })
  })

  it('keeps unknown career stats NULL rather than defaulting them to zero', () => {
    // Real rows look like this: Agueda Perez has no win_rate/total_matches/titles.
    const v = describeMarket(
      withIdentity([{ win_rate: null, total_matches: null, titles: null, avatar_url: null }]),
      'en',
    )
    expect(v.players?.pair1[0]).toMatchObject({
      winRate: null, totalMatches: null, titles: null, avatarUrl: null,
    })
  })

  it('attaches form by player id, and leaves it null when absent', () => {
    const form = new Map([['p0', { wins: 4, of: 5, streak: 'WLWWW' }]])
    const v = describeMarket(withIdentity(), 'en', Date.now(), { form })
    expect(v.players?.pair1[0]?.form).toEqual({ wins: 4, of: 5, streak: 'WLWWW' })
    expect(v.players?.pair1[1]?.form).toBeNull()
  })

  it('carries head-to-head keyed by market id, zeroes included', () => {
    const h2h = new Map([['m1', { pair1Wins: 0, pair2Wins: 0 }]])
    // A 0-0 is a real answer ("never met"), NOT an absence — it must survive.
    expect(describeMarket(withIdentity(), 'en', Date.now(), { h2h }).h2h)
      .toEqual({ pair1Wins: 0, pair2Wins: 0 })
    expect(describeMarket(withIdentity(), 'en', Date.now(), {}).h2h).toBeNull()
  })

  it('falls back to the denormalised name when a player FK is null', () => {
    const base = withIdentity()
    const v = describeMarket(
      mkMarket({
        match: {
          ...base.match!,
          pair1_player1: null, pair1_player1_id: null,
          pair1_player1_name: 'Arturo Coello',
        },
      }),
      'en',
    )
    expect(v.players?.pair1[0]).toMatchObject({ surname: 'Coello', ranking: null, avatarUrl: null })
  })

  it('has no players for a market with no match — those cards keep the monogram', () => {
    const v = describeMarket(
      mkMarket({ match_id: null, match: null, tournament_id: 't', tournament: { name: 'Madrid P1', level: 'p1' } }),
      'en',
    )
    expect(v.players).toBeNull()
    expect(v.h2h).toBeNull()
  })
})

describe('trade math invariants', () => {
  it('buy then immediate sell never mints guacas', () => {
    const buy = quoteBuy(seeded.qYes, seeded.qNo, b, 'yes', 500)
    const sell = quoteSell(buy.qYesAfter, buy.qNoAfter, b, 'yes', buy.shares)
    expect(sell.refund).toBeLessThanOrEqual(buy.cost)
    expect(Number.isInteger(buy.cost)).toBe(true)
    expect(Number.isInteger(sell.refund)).toBe(true)
  })

  it('q values are NOT share counts — seeding below 0.5 yields negative q', () => {
    const low = seedShares(0.2, b)
    expect(low.qYes).toBeLessThan(0)
    // A naive "do you hold enough" check against q would be nonsense.
    expect(priceYes(low.qYes, low.qNo, b)).toBeCloseTo(0.2, 6)
  })

  it('avgPrice stays inside (0,1) so numeric(5,4) cannot overflow', () => {
    for (const stake of [1, 10, 500, 2000]) {
      const q = quoteBuy(seeded.qYes, seeded.qNo, b, 'no', stake)
      expect(q.avgPrice).toBeGreaterThan(0)
      expect(q.avgPrice).toBeLessThan(1)
    }
  })
})

describe('helpers', () => {
  it('coerces PostgREST numeric strings', () => {
    expect(num('0.6200')).toBeCloseTo(0.62)
    expect(num(null, 7)).toBe(7)
    expect(num('not-a-number', 3)).toBe(3)
  })

  it('prices the no side as the complement', () => {
    expect(sidePrice(0.62, 'no')).toBeCloseTo(0.38)
  })

  it('values a two-sided position at both prices', () => {
    expect(positionValue({ yes_shares: '10', no_shares: '4' }, 0.5)).toBeCloseTo(7)
  })

  it('rejects unknown locales', () => {
    expect(parseLocale('de')).toBe('en')
    expect(parseLocale('pt')).toBe('pt')
  })
})

describe('frozen editorial definitions',()=>{
  it('keeps the published question and localized rules after template changes',()=>{
    const market=mkMarket({question_snapshot:{en:'Frozen question',es:'Pregunta publicada'},rules_snapshot:{en:'Frozen rules',es:'Reglas publicadas'},template:{question_i18n:{en:'Changed template'},horizon:'tournament'}})
    const view=describeMarket(market,'es')
    expect(view.question).toBe('Pregunta publicada');expect(view.rules).toBe('Reglas publicadas')
  })
})
