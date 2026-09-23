// Pure classification of a PPL roster against our `players` table.
//
// Four buckets, and the important one is `ambiguous`. A measured probe on
// 2026-09-23 found six PPL names matching more than one existing player, two
// with IDENTICAL normalized names (Claudia Jensen, Javier Martinez). Picking
// one automatically would hang league matches on the wrong person's career
// history — the exact class of bug the repo was already fixing elsewhere.
//
// So: ambiguity is never guessed. It goes in its own bucket, the dry run
// prints it, and `--apply` refuses until a human maps it.
//
// Two matching tiers, neither of them fuzzy:
//   1. exact normalized `name`
//   2. strict token subset against `name` OR `display_name` — the house
//      short-name column (see src/lib/player-name.ts and
//      src/lib/player-short-name.ts)
//
// An exact `display_name` index was tried as a third tier and removed: an
// exact match implies a subset match, and tier 2 already reads the column,
// so it changed nothing. Measured on the real 132-player roster — identical
// 100/28/4 with and without it.
//
// No Levenshtein, no similarity score. Both tiers ADD candidates; neither
// chooses among them. Two or more survivors is always `ambiguous`.

import type { PplPlayer } from './ppl-source'

export interface ExistingPlayer {
  id: string
  name: string | null
  /** Curated broadcast form, e.g. "Paquito Navarro" for "Francisco Navarro". Populated for ~1% of rows. */
  display_name: string | null
  normalized_name: string | null
  category: string | null
  tier: string | null
}

export interface LinkedEntry { player: PplPlayer; playerId: string }
export interface CreateEntry { player: PplPlayer; category: 'men' | 'women' }
export interface AmbiguousEntry { player: PplPlayer; candidates: ExistingPlayer[] }

export interface Classification {
  /** Already carries an `entity_external_ids` row for source='ppl'. Nothing to do. */
  linked: LinkedEntry[]
  /** Unambiguous match — needs only the sidecar registration. */
  toLink: LinkedEntry[]
  /** No match at all — needs a new `players` row. */
  toCreate: CreateEntry[]
  /** More than one candidate. Blocks `--apply`. */
  ambiguous: AmbiguousEntry[]
}

/**
 * Mirrors the `set_player_normalized_name` trigger closely enough for
 * matching: lowercase, strip diacritics, non-alphanumerics to spaces,
 * collapse. The DB value is authoritative when present; this is the fallback
 * and the way incoming PPL names are normalized.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function categoryOf(sex: string | null): 'men' | 'women' {
  return sex === 'female' ? 'women' : 'men'
}

function tokens(s: string): Set<string> {
  return new Set(normalizeForMatch(s).split(' ').filter(Boolean))
}

/**
 * Tier 2 — every token of the PPL name must appear in ours, checked against
 * both the canonical `name` and the curated `display_name`.
 *
 * PPL publishes the broadcast form; our `players.name` is FIP-sourced and
 * carries the full Spanish double surname. Measured on 2026-09-23 against
 * the 132-player roster:
 *
 *   exact on name only                67 resolved   63 missed
 *   + exact on display_name           75 resolved   55 missed
 *   + this subset tier               100 resolved   26 missed
 *
 * Exact-only would have created 63 duplicates, including the women's world
 * No. 1 twice over (`Gemma Triay` vs our `Gemma Triay Pons`, `Delfi Brea`
 * vs `Delfina Brea Senesi`).
 *
 * Deliberately STRICT and one-directional: the PPL name must be a subset of
 * ours, never the reverse. A reverse match would let our bare `Marta` swallow
 * PPL's `Marta Ortega`. Minimum two tokens, so a lone surname cannot match.
 *
 * This tier only ADDS candidates — it never picks among them. Two or more
 * survivors still land in `ambiguous` and still block `--apply`.
 */
function subsetCandidates(
  name: string,
  category: string,
  pool: ExistingPlayer[],
): ExistingPlayer[] {
  const want = tokens(name)
  if (want.size < 2) return []
  return pool.filter((o) => {
    if (o.category !== category) return false
    for (const source of [o.name, o.display_name]) {
      if (!source) continue
      const have = tokens(source)
      if ([...want].every((t) => have.has(t))) return true
    }
    return false
  })
}

export function classifyRoster(
  roster: PplPlayer[],
  existing: ExistingPlayer[],
  /** pplSlug → players.id, from entity_external_ids source='ppl' */
  alreadyRegistered: Map<string, string>,
  /** pplSlug → players.id, operator-supplied overrides */
  overrides: Map<string, string>,
): Classification {
  // Amateur rows are a separate population and must never be matched —
  // see src/lib/player-tier.ts.
  const pool = existing.filter((p) => p.tier !== 'amateur')

  const byName = new Map<string, Map<string, ExistingPlayer>>()
  for (const p of pool) {
    const key = p.normalized_name || normalizeForMatch(p.name ?? '')
    if (!key) continue
    if (!byName.has(key)) byName.set(key, new Map())
    byName.get(key)!.set(p.id, p)
  }

  const exact = (name: string, category: string): ExistingPlayer[] =>
    [...(byName.get(normalizeForMatch(name)) ?? new Map<string, ExistingPlayer>()).values()]
      .filter((c) => c.category === category)

  const out: Classification = { linked: [], toLink: [], toCreate: [], ambiguous: [] }

  for (const player of roster) {
    const registered = alreadyRegistered.get(player.slug)
    if (registered) { out.linked.push({ player, playerId: registered }); continue }

    const override = overrides.get(player.slug)
    if (override) { out.toLink.push({ player, playerId: override }); continue }

    const category = categoryOf(player.sex)
    const exactHits = exact(player.name, category)
    const candidates = exactHits.length > 0
      ? exactHits
      : subsetCandidates(player.name, category, pool)

    if (candidates.length === 1) out.toLink.push({ player, playerId: candidates[0].id })
    else if (candidates.length === 0) out.toCreate.push({ player, category })
    else out.ambiguous.push({ player, candidates })
  }

  return out
}
