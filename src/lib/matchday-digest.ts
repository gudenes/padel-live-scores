// src/lib/matchday-digest.ts
// Pure helpers for the matchday digest: approximate-label detection, body
// formatting, and recipient grouping. No I/O.

export function isApproximateLabel(label: string | null | undefined): boolean {
  if (!label) return false
  return /not before/i.test(label) || /followed by/i.test(label)
}

export type DigestItem = { label: string; time: string; approximate: boolean }

export function formatDigestBody(items: DigestItem[], cap = 4): string {
  const shown = items.slice(0, cap).map((i) => `${i.label} ${i.time}${i.approximate ? '*' : ''}`)
  const extra = items.length - cap
  if (extra > 0) shown.push(`+${extra} more`)
  return shown.join(' · ')
}

export type DigestMatch = { matchId: string; players: (string | null)[] }
type Bookmark = { user_id: string; target_id: string }

export function groupRecipients(
  matches: DigestMatch[],
  playerFollows: Bookmark[],
  matchBookmarks: Bookmark[],
): Map<string, string[]> {
  const matchesByPlayer = new Map<string, string[]>()
  for (const m of matches) for (const p of m.players) {
    if (!p) continue
    const arr = matchesByPlayer.get(p) ?? []
    arr.push(m.matchId)
    matchesByPlayer.set(p, arr)
  }
  const out = new Map<string, Set<string>>()
  const add = (u: string, mid: string) => { const s = out.get(u) ?? new Set<string>(); s.add(mid); out.set(u, s) }
  for (const f of playerFollows) for (const mid of matchesByPlayer.get(f.target_id) ?? []) add(f.user_id, mid)
  const matchIds = new Set(matches.map((m) => m.matchId))
  for (const b of matchBookmarks) if (matchIds.has(b.target_id)) add(b.user_id, b.target_id)
  return new Map([...out].map(([u, s]) => [u, [...s].sort()]))
}
