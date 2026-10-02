// padelgod/src/lib/coach-normalize.ts
//
// Coach-name normalization. Same as db-resolver's normalizeName, except
// apostrophes are REMOVED before punctuation→space, so "D’antonio" and
// "Dantonio" collapse to the same key (dry run 2026-10-02: they didn't).
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md

const APOSTROPHES = /['’‘`´]/g

export function normalizeCoachName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokens of an already-normalized name, ignoring 1-char tokens (initials). */
export function coachTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 1)
}

export function slugifyCoach(displayName: string): string {
  return normalizeCoachName(displayName).replace(/ /g, '-')
}

/** Returns a slug not in `taken` (base, base-2, base-3, …) and adds it to `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'coach'
  let slug = root
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`
  taken.add(slug)
  return slug
}
