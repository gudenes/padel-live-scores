// src/lib/player-suggestion-fields.ts
//
// Single source of truth for the player "Suggest changes" feature.
// Maps suggestable form-field keys → players table columns, and provides
// pure sanitizers shared by the submit route, the ops apply route, and
// the SuggestChangesSheet. Keep this list in sync with the sheet's inputs
// and the ops tab's field labels.

/** Form field key → players column. The whitelist that guards every write. */
export const SUGGESTABLE_FIELDS = {
  full_name: 'name',
  country: 'country',
  birthplace: 'birthplace',
  birthdate: 'birthdate',
  height: 'height',
  hand: 'hand',
  side: 'side',
} as const

export type SuggestableField = keyof typeof SUGGESTABLE_FIELDS

export interface CleanChange {
  field: SuggestableField
  current: string | null
  suggested: string
}

const MAX_SUGGESTED = 200
const MAX_COMMENT = 1000

export function isSuggestableField(field: string): field is SuggestableField {
  return Object.prototype.hasOwnProperty.call(SUGGESTABLE_FIELDS, field)
}

export function columnForField(field: SuggestableField): string {
  return SUGGESTABLE_FIELDS[field]
}

/**
 * Clean an untrusted `changes` payload into validated CleanChange[]:
 * - keep only whitelisted fields
 * - trim + length-cap the suggested value
 * - drop empty suggestions and no-ops (suggested === current)
 * - dedupe by field (first occurrence wins)
 */
export function sanitizeChanges(raw: unknown): CleanChange[] {
  if (!Array.isArray(raw)) return []
  const out: CleanChange[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const field = rec.field
    if (typeof field !== 'string' || !isSuggestableField(field)) continue
    if (seen.has(field)) continue

    const suggested =
      typeof rec.suggested === 'string' ? rec.suggested.trim().slice(0, MAX_SUGGESTED) : ''
    if (!suggested) continue

    const current = typeof rec.current === 'string' ? rec.current.trim() : null
    if (suggested === (current ?? '')) continue

    seen.add(field)
    out.push({ field, current, suggested })
  }
  return out
}

export function sanitizeComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, MAX_COMMENT)
  return trimmed || null
}
