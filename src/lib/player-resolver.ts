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
}

export interface ResolveResult {
  playerId: string
  action: 'found' | 'enriched' | 'created'
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

function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.max(ta.size, tb.size)
}

// ── In-memory player cache ───────────────────────────────────────────────
// Rebuilt per resolver instance to avoid stale data across requests.

interface CachedPlayer {
  id: string
  externalId: string | null
  fipId: string | null
  name: string
  country: string | null
  category: string | null
}

export class PlayerResolver {
  private supabase: SupabaseClient
  private byExternalId = new Map<string, CachedPlayer>()
  private byFipId = new Map<string, CachedPlayer>()
  private byNormalizedName = new Map<string, CachedPlayer[]>()
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
        .select('id, external_id, fip_id, name, country, category')
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
        country: p.country,
        category: p.category,
      }
      if (p.external_id) this.byExternalId.set(p.external_id, cached)
      if (p.fip_id) this.byFipId.set(p.fip_id, cached)
      const norm = normalize(p.name)
      if (!this.byNormalizedName.has(norm)) this.byNormalizedName.set(norm, [])
      this.byNormalizedName.get(norm)!.push(cached)
    }
    console.log(`[PlayerResolver] Loaded ${allData.length} players into cache`)
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

    // 3. Exact normalized name match (prefer same category)
    if (!existing) {
      const norm = normalize(input.name)
      const candidates = this.byNormalizedName.get(norm)
      if (candidates) {
        // Prefer same category
        existing = candidates.find(c => c.category === input.category) ?? candidates[0]
      }
    }

    // 4. Fuzzy name match (token overlap ≥ 0.9, same category)
    if (!existing && input.category) {
      let bestScore = 0
      for (const [, players] of this.byNormalizedName) {
        for (const p of players) {
          if (p.category !== input.category) continue
          const sim = tokenSimilarity(input.name, p.name)
          if (sim >= 0.9 && sim > bestScore) {
            // Extra check: if both have country, they must match
            if (input.country && p.country && input.country !== p.country) continue
            bestScore = sim
            existing = p
          }
        }
      }
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
        .select('id, external_id, fip_id, name, country, category')
        .eq('external_id', insertData.external_id)
        .single()
      fallback = f1

      if (!fallback && insertData.fip_id) {
        const { data: f2 } = await this.supabase
          .from('players')
          .select('id, external_id, fip_id, name, country, category')
          .eq('fip_id', insertData.fip_id)
          .single()
        fallback = f2
      }

      if (fallback) {
        // Update cache so subsequent lookups succeed
        const cached: CachedPlayer = {
          id: fallback.id,
          externalId: (fallback as any).external_id ?? null,
          fipId: (fallback as any).fip_id ?? null,
          name: (fallback as any).name ?? input.name,
          country: (fallback as any).country ?? null,
          category: (fallback as any).category ?? null,
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
    const cached: CachedPlayer = {
      id: data.id,
      externalId: insertData.external_id,
      fipId: insertData.fip_id ?? null,
      name: input.name,
      country: input.country ?? null,
      category: input.category ?? null,
    }
    this.byExternalId.set(insertData.external_id, cached)
    if (insertData.fip_id) this.byFipId.set(insertData.fip_id, cached)
    const norm = normalize(input.name)
    if (!this.byNormalizedName.has(norm)) this.byNormalizedName.set(norm, [])
    this.byNormalizedName.get(norm)!.push(cached)

    return { playerId: data.id, action: 'created' }
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

    if (Object.keys(enrichFields).length > 0) {
      enrichFields.updated_at = new Date().toISOString()
      await this.supabase
        .from('players')
        .update(enrichFields)
        .eq('id', result.playerId)
    }

    return { playerId: result.playerId, action: result.action === 'created' ? 'created' : 'enriched' }
  }
}
