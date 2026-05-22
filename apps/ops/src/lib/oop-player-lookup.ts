// apps/ops/src/lib/oop-player-lookup.ts
//
// Lifted verbatim from src/lib/oop-player-lookup.ts in the main app.
// The `normalize` function is inlined here (from src/lib/player-resolver.ts)
// rather than importing the full player-resolver module.

import type { SupabaseClient } from '@supabase/supabase-js'

// ── normalize (inlined from src/lib/player-resolver.ts) ──────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OopAbbreviatedName {
  /** Uppercase first letter of the first name, e.g. "C" from "C. Orsi". */
  initial: string
  /** Everything after the first space, preserving multi-word surnames. */
  surname: string
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse OOP-style "X. Surname" into parts. Tolerates trailing periods on the
 * initial, multi-word surnames, and extra whitespace. Returns null for any
 * unexpected shape.
 */
export function parseAbbreviatedName(
  raw: string | null | undefined,
): OopAbbreviatedName | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^(\S+)\s+(.+)$/)
  if (!match) return null

  const initialRaw = match[1]!.replace(/\.$/, '').trim()
  const surnameRaw = match[2]!.trim()
  if (!initialRaw || !surnameRaw) return null

  return {
    initial: initialRaw.charAt(0).toUpperCase(),
    surname: surnameRaw,
  }
}

/**
 * Resolve an OOP abbreviated name to a players.id. Returns null when zero or
 * multiple candidates match — callers should leave the slot as-is (TBD).
 *
 * @param supabase      Supabase client (service-key scope recommended)
 * @param abbreviated   e.g. "C. Orsi", "P. Llaguno Zielinski"
 * @param category      'men' | 'women' — required to scope the search
 */
export async function resolveOopPlayerToId(
  supabase: SupabaseClient,
  abbreviated: string,
  category: 'men' | 'women',
): Promise<string | null> {
  const parts = parseAbbreviatedName(abbreviated)
  if (!parts) return null

  const surnameTokens = normalize(parts.surname)
    .split(' ')
    .filter((t) => t.length >= 2)
  if (surnameTokens.length === 0) return null

  const searchToken = surnameTokens[surnameTokens.length - 1]!

  const { data, error } = await supabase
    .from('players')
    .select('id, name, normalized_name, category')
    .eq('category', category)
    .ilike('normalized_name', `%${searchToken}%`)
    .limit(50)

  if (error || !data) return null

  const initialLower = parts.initial.toLowerCase()

  const matches = data.filter((p) => {
    const norm = (p.normalized_name ?? normalize(p.name)) as string
    const normTokens = norm.split(' ').filter((t) => t.length > 0)
    if (normTokens.length === 0) return false

    if (normTokens[0]!.charAt(0) !== initialLower) return false

    for (const st of surnameTokens) {
      if (!normTokens.includes(st)) return false
    }
    return true
  })

  if (matches.length === 1) return matches[0]!.id as string
  return null
}
