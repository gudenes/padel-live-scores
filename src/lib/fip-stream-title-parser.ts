// src/lib/fip-stream-title-parser.ts
//
// Shared tokenizer used by tournament/title-overlap matching. Strips
// diacritics, lowercases, splits on non-alphanumerics, and drops the
// noise tokens that would otherwise produce false positives ("padel",
// "fip", "tour", year tokens, etc.).

const NOISE_TOKENS = new Set([
  'fip', 'premier', 'padel', 'tour', 'open', 'cup',
  'live', 'highlights', 'recap', 'stream', 'streaming',
  'official', 'tv', 'youtube',
])

const YEAR_RE = /^\d{4}$/

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function tokenize(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0)
    .filter(t => !NOISE_TOKENS.has(t))
    .filter(t => !YEAR_RE.test(t))
}
