/** Presentation data only; settlement remains owned by the resolver. */
export interface EditorialView {
  kind: 'ranking' | 'titles' | 'round' | 'other_champion'
  players: { id: string; name: string; avatarUrl: string | null; photoUrl: string | null; ranking: number | null }[]
  completed?: number | null
  target: number | null
  round: string | null
  endsAt: string | null
  scope: string | null
  openingProbability: number | null
  source: string | null
}
export function parseEditorialView(raw: unknown): EditorialView | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as EditorialView
  if (!['ranking','titles','round','other_champion'].includes(v.kind) || !Array.isArray(v.players)) return null
  if (!v.players.every(p => p && typeof p.id === 'string' && typeof p.name === 'string')) return null
  return {
    kind: v.kind, players: v.players.slice(0,2).map(p => ({id:p.id,name:p.name,
      avatarUrl: typeof p.avatarUrl === 'string' ? p.avatarUrl : null,
      photoUrl: typeof p.photoUrl === 'string' ? p.photoUrl : null,
      ranking: Number.isFinite(p.ranking) && p.ranking! > 0 ? p.ranking : null})),
    completed: typeof v.completed === 'number' && Number.isInteger(v.completed) && v.completed >= 0 ? v.completed : null,
    target: Number.isFinite(v.target) && v.target! > 0 ? v.target : null,
    round: typeof v.round === 'string' ? v.round : null,
    endsAt: typeof v.endsAt === 'string' && Number.isFinite(Date.parse(v.endsAt)) ? v.endsAt : null,
    scope: typeof v.scope === 'string' ? v.scope : null,
    openingProbability: typeof v.openingProbability === 'number' && v.openingProbability > 0 && v.openingProbability < 1 ? v.openingProbability : null,
    source: typeof v.source === 'string' ? v.source : null,
  }
}
