// apps/ops/src/lib/ad-banner-stats.ts
// Pure helpers for per-banner engagement stats. No Supabase, no DOM — so the
// merge and the display formatting can be unit-tested in isolation.

export interface BannerStatRow {
  banner_id: string
  impressions: number
  clicks: number
}

export interface WithStats {
  impressions: number
  clicks: number
}

const countFmt = new Intl.NumberFormat('en-US')

/** Whole-number count with thousands separators (e.g. 1,234). */
export function formatCount(n: number): string {
  return countFmt.format(n)
}

/**
 * Click-through rate as a 1-decimal percentage. Returns an em dash when there
 * are no impressions (avoids NaN / Infinity for a banner that never rendered).
 */
export function formatCtr(clicks: number, impressions: number): string {
  if (!impressions) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

/**
 * Attach impressions/clicks to each banner by id, zero-filling banners with no
 * stats row. Counts are coerced to numbers (pg sum()/count() may arrive as
 * strings via the bigint type).
 */
export function mergeBannerStats<T extends { id: string }>(
  banners: T[],
  stats: BannerStatRow[],
): (T & WithStats)[] {
  const byId = new Map(stats.map((s) => [s.banner_id, s]))
  return banners.map((b) => {
    const s = byId.get(b.id)
    return { ...b, impressions: Number(s?.impressions ?? 0), clicks: Number(s?.clicks ?? 0) }
  })
}
