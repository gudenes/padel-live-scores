// src/lib/player-resolver.ts
// Shared player resolution service.
// All player ingestion routes should use resolvePlayer() to look up or create
// player records, ensuring consistent deduplication and data enrichment.

import { SupabaseClient } from '@supabase/supabase-js'

// ── Types ────────────────────────────────────────────────────────────────

export interface PlayerInput {
  /** padelapi.org numeric ID (as string) */
  externalId?: string | null
  /** FIP player ID (format: "fip-12345") */
  fipId?: string | null
  /** Player full name */
  name: string
  /** ISO 2-letter country code */
  country?: string | null
  /** 'men' or 'women' */
  category?: string | null
  /** Playing side */
  side?: string | null
  /** Avatar/photo URL */
  avatarUrl?: string | null
  /** Profile page URL */
  profileUrl?: string | null
  /** Official ranking */
  ranking?: number | null
  /** Ranking points */
  points?: number | null
  /** Ranking movement */
  rankingMove?: number | null
  /** Race ranking */
  raceRanking?: number | null
  /** Race points */
  racePoints?: number | null
  /** Race movement */
  raceMove?: number | null
  /** Height in cm */
  height?: number | null
  /** Birthplace */
  birthplace?: string | null
  /** Birthdate (ISO date string) */
  birthdate?: string | null
  /** Dominant hand */
  hand?: string | null
  /** Win rate percentage */
  winRate?: number | null
  /** Total matches played */
  totalMatches?: number | null
  /** Tournament titles */
  titles?: number | null
  /** Finals appearances */
  finals?: number | null
  /** Semifinals appearances */
  semifinals?: number | null
  /** Override for updated_at (e.g. FIP ranking publication date) */
  updatedAt?: string | null
  /** FIP ranking publication date (stored separately from updated_at) */
  rankingDate?: string | null
}

export interface ResolveResult {
  playerId: string
  action: 'found' | 'enriched' | 'created'
}

export interface LookupResult {
  found: boolean
  playerId?: string
  playerName?: string
  matchType: 'exact' | 'fuzzy' | 'none'
}

export interface LookupOptions {
  /**
   * Loosen fuzzy matching to handle FIP PDF ↔ DB name/country variations.
   * When true:
   *   - Country codes are normalized via `normalizeCountry` before comparison
   *     (ARG ↔ AR, BRA ↔ BR, etc.)
   *   - `typoTolerantSimilarity` replaces `tokenSimilarity` for scoring,
   *     matching at a 0.9 threshold. This catches subset names (e.g.
   *     "Franco Renato Dal Bianco" → "Franco Dal Bianco") and 1-char typos
   *     on ≥4-letter tokens (e.g. "Giannina" → "Gianina").
   * Default: false (preserves the strict behaviour existing callers rely on).
   */
  lenient?: boolean
}

// ── Name normalization ───────────────────────────────────────────────────

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(name: string): Set<string> {
  return new Set(normalize(name).split(' ').filter(t => t.length > 1))
}

export function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.max(ta.size, tb.size)
}

// ── Country code normalization ───────────────────────────────────────────
// FIP entry list PDFs use 3-letter ISO codes (ARG, BRA, ESP); our DB stores
// 2-letter ISO codes (AR, BR, ES). When comparing, normalize to the 2-letter form.
// Only codes we actually see in FIP tour data are mapped.
const COUNTRY_3TO2: Record<string, string> = {
  ARG: 'AR', BRA: 'BR', CHI: 'CL', PAR: 'PY', ESP: 'ES', URU: 'UY',
  VEN: 'VE', USA: 'US', COL: 'CO', MEX: 'MX', ITA: 'IT', FRA: 'FR',
  POR: 'PT', DEU: 'DE', GBR: 'GB', NED: 'NL', BEL: 'BE', SWE: 'SE',
  DNK: 'DK', NOR: 'NO', FIN: 'FI', POL: 'PL', KAZ: 'KZ', RUS: 'RU',
  THA: 'TH', JPN: 'JP', CHN: 'CN', IND: 'IN', EGY: 'EG', MAR: 'MA',
  GER: 'DE', SUI: 'CH', HUN: 'HU', CZE: 'CZ', NZL: 'NZ', AUS: 'AU',
  CAN: 'CA', ISR: 'IL', TUR: 'TR', UKR: 'UA', ROU: 'RO', SVK: 'SK',
  CRO: 'HR', GRE: 'GR', BUL: 'BG', SRB: 'RS', PER: 'PE', ECU: 'EC',
  BOL: 'BO', CUB: 'CU', PAN: 'PA', CRC: 'CR',
}

export function normalizeCountry(c: string | null | undefined): string | null {
  if (!c) return null
  const up = c.trim().toUpperCase()
  if (up.length === 0) return null
  if (up.length === 2) return up
  return COUNTRY_3TO2[up] ?? up
}

// ── Subset-tolerant and typo-tolerant similarity ─────────────────────────
// FIP PDFs use full legal names ("Cristina Cirne Lima De Oliveira") while our
// DB has shortened common names ("Cristina Cirne"). The Jaccard-style
// `tokenSimilarity` scores these at 0.5 — below the fuzzy threshold — even
// though the shorter name is a subset of the longer. `subsetSimilarity` uses
// `min` instead of `max` as the denominator, returning 1.0 whenever every
// token of the shorter name appears in the longer name.

export function subsetSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.min(ta.size, tb.size)
}

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  // Two-row dynamic programming
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    [prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * Like `subsetSimilarity` but tolerates single-character typos on tokens that
 * are at least 4 characters long. Catches FIP's occasional transliteration
 * differences like "Giannina" vs "Gianina".
 */
export function typoTolerantSimilarity(a: string, b: string): number {
  const ta = [...tokens(a)]
  const tb = [...tokens(b)]
  if (ta.length === 0 || tb.length === 0) return 0
  const used = new Array<boolean>(tb.length).fill(false)
  let overlap = 0
  for (const t of ta) {
    for (let i = 0; i < tb.length; i++) {
      if (used[i]) continue
      const u = tb[i]
      if (t === u) {
        overlap++
        used[i] = true
        break
      }
      // Allow 1-char edit distance only for tokens of length >= 4 on both sides.
      // Shorter tokens (initials, 2-letter words like "de"/"la") stay strict to
      // avoid false positives.
      if (t.length >= 4 && u.length >= 4 && editDistance(t, u) <= 1) {
        overlap++
        used[i] = true
        break
      }
    }
  }
  return overlap / Math.min(ta.length, tb.length)
}

// ── In-memory player cache ───────────────────────────────────────────────
// Rebuilt per resolver instance to avoid stale data across requests.

interface CachedPlayer {
  id: string
  externalId: string | null
  fipId: string | null
  name: string
  normalizedName: string
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
}

export class PlayerResolver {
  private supabase: SupabaseClient
  private byExternalId = new Map<string, CachedPlayer>()
  private byFipId = new Map<string, CachedPlayer>()
  private byNormalizedName = new Map<string, CachedPlayer[]>()
  private byAlias = new Map<string, CachedPlayer>()  // normalized alias → player
  private loaded = false

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  /** Load all players into memory. Call once before resolving. */
  async load(): Promise<void> {
    // Supabase defaults to 1000 rows — paginate to load all players
    const allData: any[] = []
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const { data, error } = await this.supabase
        .from('players')
        .select('id, external_id, fip_id, name, normalized_name, country, category, ranking, points')
        .range(offset, offset + PAGE_SIZE - 1)

      if (error || !data) {
        console.error('[PlayerResolver] Failed to load players:', error?.message)
        break
      }

      allData.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    for (const p of allData) {
      const cached: CachedPlayer = {
        id: p.id,
        externalId: p.external_id,
        fipId: p.fip_id,
        name: p.name,
        normalizedName: p.normalized_name ?? normalize(p.name),
        country: p.country,
        category: p.category,
        ranking: p.ranking ?? null,
        points: p.points ?? null,
      }
      if (p.external_id) this.byExternalId.set(p.external_id, cached)
      if (p.fip_id) this.byFipId.set(p.fip_id, cached)
      const norm = cached.normalizedName
      if (!this.byNormalizedName.has(norm)) this.byNormalizedName.set(norm, [])
      this.byNormalizedName.get(norm)!.push(cached)
    }

    // Load aliases from entity_external_ids (source = 'alias')
    const { data: aliases } = await this.supabase
      .from('entity_external_ids')
      .select('entity_id, external_id')
      .eq('entity_type', 'player')
      .eq('source', 'alias')

    let aliasCount = 0
    if (aliases) {
      for (const a of aliases) {
        const norm = normalize(a.external_id) // alias stored as raw name, normalize for lookup
        // Find the cached player by entity_id
        const cached = this.findCachedById(a.entity_id)
        if (cached) {
          this.byAlias.set(norm, cached)
          aliasCount++
        }
      }
    }

    console.log(`[PlayerResolver] Loaded ${allData.length} players + ${aliasCount} aliases into cache`)
    this.loaded = true
  }

  /** Ensure cache is loaded. */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  /**
   * Look up an existing player or create a new one.
   * Enriches existing records with any new non-null fields.
   *
   * Lookup priority:
   *   1. fip_id (exact)
   *   2. external_id (exact)
   *   3. normalized name + category match
   *   4. fuzzy name match (token overlap ≥ 0.7 + same category)
   */
  async resolve(input: PlayerInput): Promise<ResolveResult> {
    await this.ensureLoaded()

    let existing: CachedPlayer | null = null

    // 1. Lookup by fip_id
    if (input.fipId) {
      existing = this.byFipId.get(input.fipId) ?? null
    }

    // 2. Lookup by external_id
    if (!existing && input.externalId) {
      existing = this.byExternalId.get(input.externalId) ?? null
    }

    // 2.5. Alias lookup (stored name variants from previous fuzzy matches)
    if (!existing) {
      const norm = normalize(input.name)
      const aliasMatch = this.byAlias.get(norm)
      if (aliasMatch) {
        existing = aliasMatch
      }
    }

    // 3. Exact normalized name match (prefer same category, disambiguate by ranking/points)
    if (!existing) {
      const norm = normalize(input.name)
      const candidates = this.byNormalizedName.get(norm)
      if (candidates) {
        // Filter to same category if available
        const sameCat = input.category
          ? candidates.filter(c => c.category === input.category)
          : candidates
        const pool = sameCat.length > 0 ? sameCat : candidates

        if (pool.length === 1) {
          existing = pool[0]
        } else if (pool.length > 1 && (input.ranking != null || input.points != null)) {
          // 3b. Disambiguate by ranking+points proximity
          let bestDistance = Infinity
          for (const c of pool) {
            if (c.ranking == null && c.points == null) continue
            const rDist = (input.ranking != null && c.ranking != null)
              ? Math.abs(input.ranking - c.ranking) / Math.max(input.ranking, c.ranking, 1)
              : 0.5
            const pDist = (input.points != null && c.points != null)
              ? Math.abs(input.points - c.points) / Math.max(input.points, c.points, 1)
              : 0.5
            const dist = (rDist + pDist) / 2
            if (dist < bestDistance) {
              bestDistance = dist
              existing = c
            }
          }
          // If best distance > 0.5, none are close — don't pick a bad match
          if (bestDistance > 0.5) existing = null
        } else if (pool.length > 1) {
          // No ranking/points to disambiguate — pick first (existing behavior)
          existing = pool[0]
        }
      }
    }

    // 4. Fuzzy name match (token overlap ≥ 0.7, same category)
    let fuzzyMatched = false
    if (!existing && input.category) {
      let bestScore = 0
      for (const [, players] of this.byNormalizedName) {
        for (const p of players) {
          if (p.category !== input.category) continue
          const sim = tokenSimilarity(input.name, p.name)
          if (sim >= 0.7 && sim > bestScore) {
            // Extra check: if both have country, they must match
            if (input.country && p.country && input.country !== p.country) continue
            bestScore = sim
            existing = p
            fuzzyMatched = true
          }
        }
      }
    }

    // Auto-store name variant as alias on fuzzy match success
    // This makes future lookups instant (alias hit instead of fuzzy scan)
    if (fuzzyMatched && existing) {
      await this.storeAlias(existing.id, input.name)
    }

    if (existing) {
      // Enrich existing record with any new data
      const updates = this.buildEnrichment(existing, input)
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString()
        await this.supabase
          .from('players')
          .update(updates)
          .eq('id', existing.id)

        // Update cache
        if (updates.external_id) {
          existing.externalId = updates.external_id
          this.byExternalId.set(updates.external_id, existing)
        }
        if (updates.fip_id) {
          existing.fipId = updates.fip_id
          this.byFipId.set(updates.fip_id, existing)
        }
        // Keep ranking/points in sync so disambiguation works within a session
        if (input.ranking != null) existing.ranking = input.ranking
        if (input.points != null) existing.points = input.points

        return { playerId: existing.id, action: 'enriched' }
      }
      return { playerId: existing.id, action: 'found' }
    }

    // Not found — create new player
    const insertData: Record<string, any> = {
      name: input.name,
      external_id: input.externalId ?? input.fipId ?? null,
      fip_id: input.fipId ?? null,
      category: input.category ?? null,
      country: input.country ?? null,
      side: input.side ?? null,
      avatar_url: input.avatarUrl ?? null,
      profile_url: input.profileUrl ?? null,
      ranking: input.ranking ?? null,
      points: input.points ?? null,
      ranking_move: input.rankingMove ?? null,
      race_ranking: input.raceRanking ?? null,
      race_points: input.racePoints ?? null,
      race_move: input.raceMove ?? null,
      height: input.height ?? null,
      birthplace: input.birthplace ?? null,
      birthdate: input.birthdate ?? null,
      hand: input.hand ?? null,
      win_rate: input.winRate ?? null,
      total_matches: input.totalMatches ?? null,
      titles: input.titles ?? null,
      finals: input.finals ?? null,
      semifinals: input.semifinals ?? null,
      ranking_date: input.rankingDate ?? null,
      updated_at: new Date().toISOString(),
    }

    // Remove null fields to avoid overwriting defaults
    for (const k of Object.keys(insertData)) {
      if (insertData[k] === null) delete insertData[k]
    }
    // Always need name and external_id
    if (!insertData.external_id) insertData.external_id = normalize(input.name).replace(/\s+/g, '-')

    const { data, error } = await this.supabase
      .from('players')
      .upsert(insertData, { onConflict: 'external_id' })
      .select('id')
      .single()

    if (error || !data) {
      console.error(`[PlayerResolver] Failed to create player ${input.name}:`, error?.message)
      // Fallback: try to find by external_id or fip_id in case of race condition / constraint conflict
      let fallback: { id: string } | null = null
      const { data: f1 } = await this.supabase
        .from('players')
        .select('id, external_id, fip_id, name, country, category, ranking, points')
        .eq('external_id', insertData.external_id)
        .single()
      fallback = f1

      if (!fallback && insertData.fip_id) {
        const { data: f2 } = await this.supabase
          .from('players')
          .select('id, external_id, fip_id, name, country, category, ranking, points')
          .eq('fip_id', insertData.fip_id)
          .single()
        fallback = f2
      }

      if (fallback) {
        // Update cache so subsequent lookups succeed
        const fbName = (fallback as any).name ?? input.name
        const cached: CachedPlayer = {
          id: fallback.id,
          externalId: (fallback as any).external_id ?? null,
          fipId: (fallback as any).fip_id ?? null,
          name: fbName,
          normalizedName: normalize(fbName),
          country: (fallback as any).country ?? null,
          category: (fallback as any).category ?? null,
          ranking: (fallback as any).ranking ?? null,
          points: (fallback as any).points ?? null,
        }
        if (cached.externalId) this.byExternalId.set(cached.externalId, cached)
        if (cached.fipId) this.byFipId.set(cached.fipId, cached)
        const fnorm = normalize(cached.name)
        if (!this.byNormalizedName.has(fnorm)) this.byNormalizedName.set(fnorm, [])
        if (!this.byNormalizedName.get(fnorm)!.some(p => p.id === cached.id)) {
          this.byNormalizedName.get(fnorm)!.push(cached)
        }
        return { playerId: fallback.id, action: 'found' }
      }
      throw new Error(`Failed to resolve player: ${input.name}`)
    }

    // Add to cache
    const norm = normalize(input.name)
    const cached: CachedPlayer = {
      id: data.id,
      externalId: insertData.external_id,
      fipId: insertData.fip_id ?? null,
      name: input.name,
      normalizedName: norm,
      country: input.country ?? null,
      category: input.category ?? null,
      ranking: input.ranking ?? null,
      points: input.points ?? null,
    }
    this.byExternalId.set(insertData.external_id, cached)
    if (insertData.fip_id) this.byFipId.set(insertData.fip_id, cached)
    if (!this.byNormalizedName.has(norm)) this.byNormalizedName.set(norm, [])
    this.byNormalizedName.get(norm)!.push(cached)

    return { playerId: data.id, action: 'created' }
  }

  /**
   * Look up an existing player without creating one.
   * Same resolution chain as resolve() but never creates a new player.
   *
   * Lookup priority:
   *   1. fip_id (exact)
   *   2. external_id (exact)
   *   3. normalized name + category match
   *   4. fuzzy name match (token overlap >= 0.7 + same category)
   */
  async lookup(input: PlayerInput, opts: LookupOptions = {}): Promise<LookupResult> {
    await this.ensureLoaded()

    let existing: CachedPlayer | null = null
    let matchType: 'exact' | 'fuzzy' | 'none' = 'none'
    const lenient = opts.lenient === true
    const inputCountry = lenient ? normalizeCountry(input.country) : input.country ?? null

    // 1. Lookup by fip_id
    if (input.fipId) {
      existing = this.byFipId.get(input.fipId) ?? null
      if (existing) matchType = 'exact'
    }

    // 2. Lookup by external_id
    if (!existing && input.externalId) {
      existing = this.byExternalId.get(input.externalId) ?? null
      if (existing) matchType = 'exact'
    }

    // 2.5. Alias lookup
    if (!existing) {
      const norm = normalize(input.name)
      const aliasMatch = this.byAlias.get(norm)
      if (aliasMatch) {
        existing = aliasMatch
        matchType = 'exact' // alias is a known variant — treat as exact
      }
    }

    // 3. Exact normalized name match (prefer same category, disambiguate by ranking/points)
    if (!existing) {
      const norm = normalize(input.name)
      const candidates = this.byNormalizedName.get(norm)
      if (candidates) {
        const sameCat = input.category
          ? candidates.filter(c => c.category === input.category)
          : candidates
        const pool = sameCat.length > 0 ? sameCat : candidates

        if (pool.length === 1) {
          existing = pool[0]
          matchType = 'exact'
        } else if (pool.length > 1 && (input.ranking != null || input.points != null)) {
          let bestDistance = Infinity
          for (const c of pool) {
            if (c.ranking == null && c.points == null) continue
            const rDist = (input.ranking != null && c.ranking != null)
              ? Math.abs(input.ranking - c.ranking) / Math.max(input.ranking, c.ranking, 1)
              : 0.5
            const pDist = (input.points != null && c.points != null)
              ? Math.abs(input.points - c.points) / Math.max(input.points, c.points, 1)
              : 0.5
            const dist = (rDist + pDist) / 2
            if (dist < bestDistance) {
              bestDistance = dist
              existing = c
            }
          }
          if (bestDistance > 0.5) existing = null
          if (existing) matchType = 'exact'
        } else if (pool.length > 1) {
          existing = pool[0]
          matchType = 'exact'
        }
      }
    }

    // 4. Fuzzy name match
    //    Strict:  tokenSimilarity >= 0.7, exact country match (both must match char-for-char)
    //    Lenient: typoTolerantSimilarity >= 0.9, country compared after normalizeCountry
    //             (handles ARG/AR, BRA/BR, etc. and single-char typos on long tokens)
    if (!existing && input.category) {
      const scoreFn = lenient ? typoTolerantSimilarity : tokenSimilarity
      const threshold = lenient ? 0.9 : 0.7
      let bestScore = 0
      for (const [, players] of this.byNormalizedName) {
        for (const p of players) {
          if (p.category !== input.category) continue
          // Country mismatch blocks the match when both sides have a country.
          // In lenient mode, normalize candidate country so 3-letter FIP codes
          // compare equal to our 2-letter ISO codes.
          const candCountry = lenient ? normalizeCountry(p.country) : p.country
          if (inputCountry && candCountry && inputCountry !== candCountry) continue
          const sim = scoreFn(input.name, p.name)
          if (sim >= threshold && sim > bestScore) {
            bestScore = sim
            existing = p
          }
        }
      }
      if (existing) {
        matchType = 'fuzzy'
        // Auto-store alias for future instant lookup
        await this.storeAlias(existing.id, input.name)
      }
    }

    if (existing) {
      return {
        found: true,
        playerId: existing.id,
        playerName: existing.name,
        matchType,
      }
    }

    return { found: false, matchType: 'none' }
  }

  /**
   * Store a name variant as an alias in entity_external_ids.
   * Future lookups will hit the alias cache (instant) instead of fuzzy scan.
   */
  private async storeAlias(playerId: string, rawName: string): Promise<void> {
    const norm = normalize(rawName)
    // Skip if this normalized name is already the player's canonical name
    const cached = this.findCachedById(playerId)
    if (cached && cached.normalizedName === norm) return
    // Skip if already in alias cache
    if (this.byAlias.has(norm)) return

    try {
      await this.supabase
        .from('entity_external_ids')
        .upsert({
          entity_type: 'player',
          entity_id: playerId,
          source: 'alias',
          external_id: rawName, // store the original raw name (not normalized)
          metadata: { normalized: norm },
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'source,entity_type,external_id' })

      // Update in-memory cache
      if (cached) {
        this.byAlias.set(norm, cached)
      }
      console.log(`[PlayerResolver] Stored alias "${rawName}" → ${cached?.name ?? playerId}`)
    } catch {
      // Non-critical — alias storage failure doesn't break resolution
    }
  }

  /** Find a cached player by DB id (for post-enrichment cache updates). */
  private findCachedById(id: string): CachedPlayer | null {
    for (const [, players] of this.byNormalizedName) {
      for (const p of players) {
        if (p.id === id) return p
      }
    }
    return null
  }

  /**
   * Return the `fip_id` of the given cached player, or null if not in cache
   * or the player has no fip_id. Callers that need the fip_id after
   * `lookup()` returns a `playerId` use this to avoid another DB round-trip.
   */
  async getFipIdForPlayer(playerId: string): Promise<string | null> {
    await this.ensureLoaded()
    const cached = this.findCachedById(playerId)
    return cached?.fipId ?? null
  }

  /** Build update object to enrich existing player with new non-null data. */
  private buildEnrichment(existing: CachedPlayer, input: PlayerInput): Record<string, any> {
    const updates: Record<string, any> = {}

    // Set fip_id if we have one and player doesn't
    if (input.fipId && !existing.fipId) {
      updates.fip_id = input.fipId
    }

    // Set external_id if player only has fip-* and we have a numeric one
    if (input.externalId && existing.externalId?.startsWith('fip-') && !input.externalId.startsWith('fip-')) {
      // Move current fip-* external_id to fip_id if not set
      if (!existing.fipId) updates.fip_id = existing.externalId
      updates.external_id = input.externalId
    }

    // Enrich nullable fields — only fill if existing is null
    // We need to query the full record for this
    return updates
  }

  /**
   * Resolve and enrich: same as resolve() but also updates data fields.
   * Use this when you have rich player data (rankings, stats, etc).
   */
  async resolveAndEnrich(input: PlayerInput): Promise<ResolveResult> {
    await this.ensureLoaded()

    // First resolve to find/create the player
    const result = await this.resolve(input)

    // Then enrich with all provided fields
    const enrichFields: Record<string, any> = {}
    const fieldMap: Array<[keyof PlayerInput, string]> = [
      ['country', 'country'],
      ['side', 'side'],
      ['avatarUrl', 'avatar_url'],
      ['profileUrl', 'profile_url'],
      ['ranking', 'ranking'],
      ['points', 'points'],
      ['rankingMove', 'ranking_move'],
      ['raceRanking', 'race_ranking'],
      ['racePoints', 'race_points'],
      ['raceMove', 'race_move'],
      ['height', 'height'],
      ['birthplace', 'birthplace'],
      ['birthdate', 'birthdate'],
      ['hand', 'hand'],
      ['winRate', 'win_rate'],
      ['totalMatches', 'total_matches'],
      ['titles', 'titles'],
      ['finals', 'finals'],
      ['semifinals', 'semifinals'],
      ['category', 'category'],
    ]

    for (const [inputKey, dbKey] of fieldMap) {
      if (input[inputKey] != null) {
        enrichFields[dbKey] = input[inputKey]
      }
    }

    if (input.fipId) enrichFields.fip_id = input.fipId
    if (input.rankingDate) enrichFields.ranking_date = input.rankingDate

    if (Object.keys(enrichFields).length > 0) {
      enrichFields.updated_at = input.updatedAt ?? new Date().toISOString()
      await this.supabase
        .from('players')
        .update(enrichFields)
        .eq('id', result.playerId)

      // Update cached player ranking/points so disambiguation works within this session
      const cached = this.findCachedById(result.playerId)
      if (cached) {
        if (input.ranking != null) cached.ranking = input.ranking
        if (input.points != null) cached.points = input.points
      }
    }

    return { playerId: result.playerId, action: result.action === 'created' ? 'created' : 'enriched' }
  }
}
