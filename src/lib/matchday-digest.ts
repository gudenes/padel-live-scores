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

// null viaPlayerId = the recipient is on this match via a match-bookmark, not a
// player-follow (so there's no specific followed player to label the line with).
export type RecipientMatch = { matchId: string; viaPlayerId: string | null }

export function groupRecipients(
  matches: DigestMatch[],
  playerFollows: Bookmark[],
  matchBookmarks: Bookmark[],
): Map<string, RecipientMatch[]> {
  const matchesByPlayer = new Map<string, string[]>()
  for (const m of matches) for (const p of m.players) {
    if (!p) continue
    const arr = matchesByPlayer.get(p) ?? []
    arr.push(m.matchId)
    matchesByPlayer.set(p, arr)
  }
  // recipient → matchId → viaPlayerId (player-follow wins over bookmark; first follow wins)
  const out = new Map<string, Map<string, string | null>>()
  const ensure = (u: string) => { let m = out.get(u); if (!m) { m = new Map(); out.set(u, m) } return m }
  for (const f of playerFollows) for (const mid of matchesByPlayer.get(f.target_id) ?? []) {
    const m = ensure(f.user_id)
    if (!m.has(mid) || m.get(mid) == null) m.set(mid, f.target_id)
  }
  const matchIds = new Set(matches.map((m) => m.matchId))
  for (const b of matchBookmarks) if (matchIds.has(b.target_id)) {
    const m = ensure(b.user_id)
    // Only fill matches not already present via a player-follow — never
    // overwrite a real viaPlayerId with null.
    if (!m.has(b.target_id)) m.set(b.target_id, null)
  }
  // materialize, sorted by matchId for determinism
  return new Map(
    [...out].map(([u, mm]) => [
      u,
      [...mm.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([matchId, viaPlayerId]) => ({ matchId, viaPlayerId })),
    ]),
  )
}
