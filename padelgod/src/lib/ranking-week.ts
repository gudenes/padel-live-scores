// Pure helper: fire ranking_updated only when the official snapshot week
// advanced. Same-week re-upserts (daily weekday ticks, deploys) must not notify.

export type YearWeek = { year: number; week: number }

export function shouldNotifyNewOfficialWeek(
  before: YearWeek | null,
  after: YearWeek | null,
): after is YearWeek {
  if (!after) return false
  if (!before) return true
  return after.year > before.year || (after.year === before.year && after.week > before.week)
}
