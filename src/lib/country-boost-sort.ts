// Pure stable-sort that lifts items matching the boost country to the top
// of the list, preserving the input's relative order within both the boosted
// and non-boosted partitions. Used by the player picker and the Following
// page's Suggested marquee to localize the surface to the visitor's country.

export function applyCountryBoost<T>(
  rows: readonly T[],
  boostCountry: string | null,
  getCountry: (row: T) => string | null | undefined,
): T[] {
  if (!boostCountry) return [...rows]
  const target = boostCountry.toUpperCase()
  const boosted: T[] = []
  const rest: T[] = []
  for (const row of rows) {
    const c = (getCountry(row) ?? '').toUpperCase()
    if (c === target) boosted.push(row)
    else rest.push(row)
  }
  return [...boosted, ...rest]
}
