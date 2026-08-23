// src/lib/match-category-reconcile.ts
//
// Self-healing repair for `matches.category` when the upstream feed lies.
//
// Why this exists
// ---------------
// `matches.category` is derived from the Crionet order-of-play page: the
// round block carries a literal "<b>Men </b>" / "<b>Women </b>" label and
// padelgod's crionet-oop parser takes it at face value
// (padelgod/src/parsers/crionet-oop.ts). For the ordinary FIP event — draw
// codes MD/MQ/WD/WQ, one men's draw and one women's draw — that label is
// correct.
//
// Multi-draw championship/Games events break it. XX MEDITERRANEAN GAMES
// (widget FIP-2026-3417, Aug 2026) ships three draws coded MA / MB / WA:
//
//   MA = men's doubles    → OOP says "Men"    ✓
//   MB = women's doubles  → OOP says "Men"    ✗  (11 matches under the M tab)
//   WA = mixed doubles    → OOP says "Women"  ✗
//
// The letters in the draw code are not gender, and the OOP header is simply
// wrong at the source, so nothing in the ingest path can catch it. The
// tournament page filters on a strict `match.category === genderFilter`, so
// a mislabelled row renders confidently under the wrong tab.
//
// How it repairs
// --------------
// Players know their own gender. We group recent matches by
// (tournament, draw-code prefix) — every match in one bracket is the same
// event — and let the players in those matches vote:
//
//   * a linked player FK votes its `players.category` (authoritative)
//   * an unlinked slot falls back to matching the abbreviated pair name
//     ("L. Savva") against `players.name`, and only votes when every row it
//     matches agrees on gender (an ambiguous surname abstains rather than
//     guessing)
//
// The name fallback matters: national-team events like the Games have no
// entry list, so PlayerResolver links nothing and all four FKs are NULL —
// exactly the case where the label is most likely to be wrong.
//
// Thresholds are deliberately strict, because a false positive silently
// moves matches to the wrong tab — the very bug we are fixing:
//
//   * MIN_VOTES     — a bracket needs real evidence, not one stray name
//   * MAJORITY      — near-unanimity, so a genuine mixed-doubles draw
//                     (roughly 50/50) abstains instead of being forced
//                     into men's or women's
//
// Measured against 30 days of production data these thresholds changed
// nothing on healthy events (MA 33/0 men, WD 16/17 women), abstained on the
// mixed draw (WA 6/3), and would have caught MB at 0/26.
//
// This only ever flips between 'men' and 'women' on an already-categorised
// row. It never invents a category for a NULL, and never introduces a third
// value — the app has no mixed-doubles concept yet, so a mixed draw is left
// alone for a human to look at.

import type { Pool } from 'pg'

/** A bracket needs at least this many player votes before we trust it. */
export const MIN_VOTES = 6

/**
 * Share of votes that must agree. 0.95 keeps a real mixed draw (≈50/50)
 * and any bracket with meaningful disagreement out of the update path.
 */
export const MAJORITY = 0.95

export type ReconcileFinding = {
  tournamentId: string
  tournament: string
  drawPrefix: string
  labelled: string[]
  majority: 'men' | 'women'
  votes: number
  menVotes: number
  womenVotes: number
  matchesAffected: number
}

/**
 * Tally player-gender votes per (tournament, draw-code prefix) and return
 * every bracket whose evidence contradicts the label on its matches.
 *
 * Read-only. Callers decide whether to apply.
 */
const FINDINGS_SQL = `
with candidate as (
  select m.id,
         m.tournament_id,
         left(split_part(m.widget_id_composite, ':', 2), 2) as draw_prefix,
         m.category,
         slot.player_id,
         slot.raw_name
  from matches m
  cross join lateral (values
      (m.pair1_player1_id, m.pair1_player1_name),
      (m.pair1_player2_id, m.pair1_player2_name),
      (m.pair2_player1_id, m.pair2_player1_name),
      (m.pair2_player2_id, m.pair2_player2_name)
    ) as slot(player_id, raw_name)
  where m.widget_id_composite is not null
    and m.category in ('men', 'women')
    and m.scheduled_at > now() - make_interval(days => $1::int)
),
-- Linked players vote directly; this is the authoritative signal.
fk_vote as (
  select c.tournament_id, c.draw_prefix, p.category as voted
  from candidate c
  join players p on p.id = c.player_id
  where p.category in ('men', 'women')
),
-- Unlinked slots fall back to the abbreviated name ("L. Savva"). A name
-- votes only when every player row it matches agrees on gender, so an
-- ambiguous surname abstains instead of casting a coin-flip vote.
name_vote as (
  select c.tournament_id, c.draw_prefix, min(p.category) as voted
  from candidate c
  join players p
    on p.name ilike (split_part(c.raw_name, '. ', 1) || '% ' || split_part(c.raw_name, '. ', 2))
  where c.player_id is null
    and c.raw_name like '_. %'
    and p.category in ('men', 'women')
  group by c.tournament_id, c.draw_prefix, c.id, c.raw_name
  having count(distinct p.category) = 1
),
votes as (
  select * from fk_vote
  union all
  select * from name_vote
),
tally as (
  select tournament_id, draw_prefix,
         count(*) as votes,
         count(*) filter (where voted = 'men')   as men_votes,
         count(*) filter (where voted = 'women') as women_votes
  from votes
  group by 1, 2
),
verdict as (
  select t.*,
         case when t.men_votes > t.women_votes then 'men' else 'women' end as majority
  from tally t
  where t.votes >= $2::int
    and greatest(t.men_votes, t.women_votes)::numeric / t.votes >= $3::numeric
)
select v.tournament_id,
       tr.name as tournament,
       v.draw_prefix,
       v.majority,
       v.votes,
       v.men_votes,
       v.women_votes,
       count(m.id)                                as matches_affected,
       array_agg(distinct m.category)             as labelled
from verdict v
join tournaments tr on tr.id = v.tournament_id
join matches m
  on m.tournament_id = v.tournament_id
 and left(split_part(m.widget_id_composite, ':', 2), 2) = v.draw_prefix
 and m.category in ('men', 'women')
 and m.category <> v.majority
group by v.tournament_id, tr.name, v.draw_prefix, v.majority,
         v.votes, v.men_votes, v.women_votes
order by tr.name, v.draw_prefix
`

const APPLY_SQL = `
update matches m
set category = $2::text, updated_at = now()
where m.tournament_id = $1::uuid
  and left(split_part(m.widget_id_composite, ':', 2), 2) = $3::text
  and m.category in ('men', 'women')
  and m.category <> $2::text
`

export async function findMiscategorised(
  pool: Pool,
  lookbackDays: number,
): Promise<ReconcileFinding[]> {
  const { rows } = await pool.query(FINDINGS_SQL, [lookbackDays, MIN_VOTES, MAJORITY])
  return rows.map(r => ({
    tournamentId: r.tournament_id,
    tournament: r.tournament,
    drawPrefix: r.draw_prefix,
    labelled: r.labelled,
    majority: r.majority,
    votes: Number(r.votes),
    menVotes: Number(r.men_votes),
    womenVotes: Number(r.women_votes),
    matchesAffected: Number(r.matches_affected),
  }))
}

export async function applyFinding(pool: Pool, finding: ReconcileFinding): Promise<number> {
  const res = await pool.query(APPLY_SQL, [
    finding.tournamentId,
    finding.majority,
    finding.drawPrefix,
  ])
  return res.rowCount ?? 0
}
