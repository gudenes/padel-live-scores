// src/lib/player-name.ts
// Shared player-name helpers used by push-notification routes.
//
// playerLastName reads display_name when set (e.g. "Gemma Triay Pons" →
// display_name "Gemma Triay" → "Triay") so titles use the form fans recognize,
// not the canonical double-surname tail. Falls back to canonical name.

export interface NameabledPlayer {
  name?: string | null
  display_name?: string | null
}

export function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

export function playerLastName(p: NameabledPlayer | null | undefined): string {
  if (!p) return ''
  return lastName(p.display_name?.trim() || p.name)
}
