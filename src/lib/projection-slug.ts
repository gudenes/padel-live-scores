// Pure helpers for projection pair URL slugs. A pair slug is a readable,
// SEO-friendly identity ("tapia-coello") derived from player surnames, but
// always resolved back to a stable pair_key against player IDs. No I/O here.

export interface SlugPlayer {
  id: string
  name: string
}

export interface SlugRow {
  pair_key: string
  pair_player_ids: string[]
}

export interface SlugIndex {
  /** canonical slug AND reversed-order slug -> pair_key */
  slugToPairKey: Map<string, string>
  /** pair_key -> canonical slug */
  pairKeyToSlug: Map<string, string>
}

/** Lowercase, strip diacritics, keep [a-z0-9], collapse to single dashes. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Last whitespace-separated token of a full name, normalized. Falls back to whole name. */
function surnameOf(name: string): string {
  const tokens = name.trim().split(/\s+/)
  const last = tokens.length > 0 ? tokens[tokens.length - 1] : name
  return normalizeToken(last) || normalizeToken(name)
}

/** Build a deterministic pair slug from its players (ordered by player id). */
export function pairSlugFromNames(players: SlugPlayer[]): string {
  return [...players]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => surnameOf(p.name))
    .join('-')
}

export function buildSlugIndex(rows: SlugRow[], nameById: Map<string, string>): SlugIndex {
  const slugToPairKey = new Map<string, string>()
  const pairKeyToSlug = new Map<string, string>()

  for (const row of rows) {
    const players: SlugPlayer[] = row.pair_player_ids.map((id) => ({ id, name: nameById.get(id) ?? id }))

    // Canonical slug: id-sorted order (same as pairSlugFromNames).
    const canonical = pairSlugFromNames(players)
    slugToPairKey.set(canonical, row.pair_key)
    pairKeyToSlug.set(row.pair_key, canonical)

    // Reversed-order slug: the only other surname ordering for a 2-player pair.
    // Store it so resolvePairSlug can resolve it by direct lookup without splitting.
    // Note: if two distinct pairs happen to share the same two normalized surnames
    // (improbable in this domain), the later row overwrites the earlier — acceptable.
    const surnames = [...players]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => surnameOf(p.name))
    const reversed = [...surnames].reverse().join('-')
    if (reversed !== canonical) {
      slugToPairKey.set(reversed, row.pair_key)
    }
  }

  return { slugToPairKey, pairKeyToSlug }
}

export interface ResolvedSlug {
  pairKey: string
  canonicalSlug: string
  /** true when the requested slug differs from canonical (caller should 308-redirect) */
  redirect: boolean
}

/**
 * Resolve a requested slug to a pair.
 *  1. Canonical slug match -> no redirect.
 *  2. Reversed-order slug match -> redirect to canonical.
 *  3. Otherwise null (caller -> notFound()).
 *
 * Both permutations are pre-stored at build time, so no splitting is needed.
 * This correctly handles compound surnames that contain hyphens (e.g. "Garrido-Lopez").
 */
export function resolvePairSlug(index: SlugIndex, requestedSlug: string): ResolvedSlug | null {
  const pairKey = index.slugToPairKey.get(requestedSlug)
  if (!pairKey) return null
  const canonicalSlug = index.pairKeyToSlug.get(pairKey)!
  return { pairKey, canonicalSlug, redirect: canonicalSlug !== requestedSlug }
}
