// apps/ops/src/lib/coaches.ts
// Shared coach types + validation for the admin coach surfaces.
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md

export type CoachStatus = 'unreviewed' | 'verified' | 'junk' | 'merged'
export const EDITABLE_STATUSES = ['unreviewed', 'verified', 'junk'] as const

export interface CoachStatsRow {
  coach_id: string
  display_name: string
  slug: string
  status: CoachStatus
  player_id: string | null
  player_count: number
  men_points: number
  women_points: number
  total_points: number
  variant_count: number
}

export interface CoachRow {
  id: string
  display_name: string
  normalized_name: string
  slug: string
  status: CoachStatus
  merged_into: string | null
  country: string | null
  avatar_url: string | null
  notes: string | null
  player_id: string | null
}

export interface CoachPatch {
  display_name?: string
  status?: (typeof EDITABLE_STATUSES)[number]
  country?: string | null
  avatar_url?: string | null
  notes?: string | null
  player_id?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nullableText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export function validateCoachPatch(
  body: Record<string, unknown>,
): { ok: true; update: CoachPatch } | { ok: false; error: string } {
  const update: CoachPatch = {}
  if ('display_name' in body) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { ok: false, error: 'display_name cannot be empty' }
    update.display_name = name
  }
  if ('status' in body) {
    if (!EDITABLE_STATUSES.includes(body.status as never)) return { ok: false, error: 'invalid status' }
    update.status = body.status as CoachPatch['status']
  }
  if ('country' in body) {
    const c = nullableText(body.country)
    if (c !== null && !/^[a-z]{2}$/i.test(c)) return { ok: false, error: 'country must be ISO alpha-2' }
    update.country = c?.toUpperCase() ?? null
  }
  if ('avatar_url' in body) update.avatar_url = nullableText(body.avatar_url)
  if ('notes' in body) update.notes = nullableText(body.notes)
  if ('player_id' in body) {
    if (body.player_id !== null && !(typeof body.player_id === 'string' && UUID.test(body.player_id))) {
      return { ok: false, error: 'invalid player_id' }
    }
    update.player_id = body.player_id as string | null
  }
  if (Object.keys(update).length === 0) return { ok: false, error: 'nothing to update' }
  return { ok: true, update }
}

export function sortByImpact<T extends { a: { total_points: number }; b: { total_points: number } }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => y.a.total_points + y.b.total_points - (x.a.total_points + x.b.total_points))
}

export const fmtPoints = (n: number) => Math.round(n).toLocaleString('en-US')
