/** Rotate the far end 180°: left/right are relative to the player facing the net. */
export function playerSidePoint(point: [number, number], fromFarEnd = point[1] < 10): [number, number] {
 return fromFarEnd ? [10 - point[0], 20 - point[1]] : [...point];
}
export function playerSideHeat(cells: Record<string, number>) {
 const combined: Record<string, number> = {};
 for (const [key, seconds] of Object.entries(cells)) {
  const [x,y] = key.split(',').map(Number);
  const normalized = y < 10 ? `${9-x},${19-y}` : key;
  combined[normalized] = (combined[normalized] ?? 0) + seconds;
 }
 return combined;
}
