// Pure: split a "40-30" / "AD-40" game-score string into per-pair labels.
export function splitGameScore(score: string | null): { a: string; b: string } | null {
  if (!score || !score.trim()) return null
  const [a, b] = score.split('-').map((x) => x.trim())
  return { a: a || '0', b: b || '0' }
}
