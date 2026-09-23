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
// Matching is exact-normalized-name only. No fuzzy, no token subset. The
// backfill runs once with a human reading the output; the cost of a missed
// link is one extra row in `toCreate` that an operator merges later, while
// the cost of a wrong link is silent and permanent.

import type { PplPlayer } from './ppl-source'

export interface ExistingPlayer {
  id: string
  name: string | null
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
  /** Unambiguous name match — needs only the sidecar registration. */
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

export function classifyRoster(
  roster: PplPlayer[],
  existing: ExistingPlayer[],
  /** pplSlug → players.id, from entity_external_ids source='ppl' */
  alreadyRegistered: Map<string, string>,
  /** pplSlug → players.id, operator-supplied overrides */
  overrides: Map<string, string>,
): Classification {
  const byName = new Map<string, ExistingPlayer[]>()
  for (const p of existing) {
    // Amateur rows are a separate population and must never be matched —
    // see src/lib/player-tier.ts.
    if (p.tier === 'amateur') continue
    const key = p.normalized_name || normalizeForMatch(p.name ?? '')
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(p)
  }

  const out: Classification = { linked: [], toLink: [], toCreate: [], ambiguous: [] }

  for (const player of roster) {
    const registered = alreadyRegistered.get(player.slug)
    if (registered) { out.linked.push({ player, playerId: registered }); continue }

    const override = overrides.get(player.slug)
    if (override) { out.toLink.push({ player, playerId: override }); continue }

    const category = categoryOf(player.sex)
    const candidates = (byName.get(normalizeForMatch(player.name)) ?? [])
      .filter((c) => c.category === category)

    if (candidates.length === 1) out.toLink.push({ player, playerId: candidates[0].id })
    else if (candidates.length === 0) out.toCreate.push({ player, category })
    else out.ambiguous.push({ player, candidates })
  }

  return out
}
