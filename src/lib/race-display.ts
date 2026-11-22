/** Display-only helpers. Never infer live totals from weekly ranking movement. */
export interface RacePosition { race_ranking: number | null; race_points: number | null }

export function raceCutoffPoints(rows: RacePosition[]): number | null {
  const groups = new Map<number, RacePosition[]>()
  for (const row of rows) {
    if (row.race_ranking == null || row.race_points == null) continue
    const group = groups.get(row.race_ranking) ?? []
    group.push(row)
    groups.set(row.race_ranking, group)
  }
  for (const [rank, group] of groups) {
    if (rank <= 16 && rank + group.length > 16) return group[0].race_points
  }
  return null
}

export function raceGap(points: number | null, cutoff: number | null): number | null {
  return points == null || cutoff == null ? null : Math.max(0, cutoff - points)
}
