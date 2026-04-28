// src/lib/thin-match-player.ts
//
// Thin-match player hydration. Amateur-tier tournaments (FIP Beyond,
// Promises, Other) sometimes can't resolve player names to FIP IDs —
// the players genuinely aren't in the FIP database. Padelgod's
// fip-draw-populator falls back to "thin matches": same widget
// composite + round + category, but the four `pair*_player*_id` FKs
// stay NULL. The raw player names from the draw bracket are written
// to `pair*_player*_name` instead.
//
// In the UI we want those matches to render — name strings, no profile
// link, no flag (we don't have country). This module synthesizes a
// minimal Player object for each null FK that has a fallback name, so
// downstream components (`MatchCard`, `pairName`, etc) keep working
// without per-component branches.
//
// Conventions:
//   - Synthetic players use `id: ''` so consumers that link to
//     `/player/<id>` can detect "no profile available" with a
//     truthiness check.
//   - `country`, `display_name`, `avatar_url`, `ranking` all stay null.
//   - We only synthesize when the FK player is null AND a name string
//     is present; missing both → leave null (TBD slot).

interface MinimalPlayer {
  id: string
  name: string | null
  display_name?: string | null
  country?: string | null
  ranking?: number | null
  // Optional fields commonly carried alongside; left undefined for thin
  // synthesis since we don't have them.
  avatar_url?: string | null
  external_id?: string | null
  win_rate?: number | null
  total_matches?: number | null
}

interface MatchRowWithThinNames {
  pair1_player1?: MinimalPlayer | null
  pair1_player2?: MinimalPlayer | null
  pair2_player1?: MinimalPlayer | null
  pair2_player2?: MinimalPlayer | null
  pair1_player1_name?: string | null
  pair1_player2_name?: string | null
  pair2_player1_name?: string | null
  pair2_player2_name?: string | null
}

/**
 * Fill in synthetic `Player` objects for any pair slot whose FK is null
 * but whose `pair*_player*_name` column is set. Mutates and returns the
 * row for chaining. Pass-through for rows where no thin names exist.
 */
export function hydrateThinPlayers<T extends MatchRowWithThinNames>(row: T): T {
  const slots: Array<['pair1_player1' | 'pair1_player2' | 'pair2_player1' | 'pair2_player2',
                      'pair1_player1_name' | 'pair1_player2_name' | 'pair2_player1_name' | 'pair2_player2_name']> = [
    ['pair1_player1', 'pair1_player1_name'],
    ['pair1_player2', 'pair1_player2_name'],
    ['pair2_player1', 'pair2_player1_name'],
    ['pair2_player2', 'pair2_player2_name'],
  ]
  for (const [fkKey, nameKey] of slots) {
    const player = row[fkKey]
    const name = row[nameKey]
    if (!player && name && name.trim()) {
      ;(row as any)[fkKey] = synthesizeThinPlayer(name)
    }
  }
  return row
}

/**
 * Build a minimal Player-like object from a raw name string. The empty
 * `id` is the marker the rest of the UI uses to suppress profile links.
 */
export function synthesizeThinPlayer(name: string): MinimalPlayer {
  return {
    id: '',
    name: name.trim(),
    display_name: null,
    country: null,
    ranking: null,
    avatar_url: null,
    external_id: null,
    win_rate: null,
    total_matches: null,
  }
}

/**
 * True when a player object is the synthesized "thin" placeholder.
 * Use this to skip profile-link rendering or follow buttons.
 */
export function isThinPlayer(p: { id?: string | null } | null | undefined): boolean {
  if (!p) return false
  return !p.id
}
