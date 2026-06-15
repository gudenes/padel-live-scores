// padelgod/src/lib/projection-slug.ts
// MIRROR of src/lib/projection-slug.ts (Next app) — keep the canonical-slug
// logic byte-compatible so worker-built deep links match the app's routes.
// Only pairSlugFromNames is mirrored (the worker doesn't resolve slugs).

export interface SlugPlayer {
  id: string;
  name: string;
}

/** Lowercase, strip diacritics, keep [a-z0-9], collapse to single dashes. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Last whitespace-separated token of a full name, normalized. Falls back to whole name. */
function surnameOf(name: string): string {
  const tokens = name.trim().split(/\s+/);
  // tokens.length > 0 is always true for split on a string, but noUncheckedIndexedAccess
  // requires the non-null assertion since TS can't prove the array is non-empty here.
  const last = tokens.length > 0 ? tokens[tokens.length - 1]! : name;
  return normalizeToken(last) || normalizeToken(name);
}

/** Deterministic pair slug from its players (ordered by player id). */
export function pairSlugFromNames(players: SlugPlayer[]): string {
  return [...players]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => surnameOf(p.name))
    .join('-');
}
