// src/lib/player-short-name.ts
//
// Renders a player's recognizable short name. Spanish and Portuguese
// names commonly have two surnames — the paternal surname (the second
// token of "Nombre Apellido1 Apellido2") is the broadcast/recognized
// form. The legacy `shortName` in src/components/home/shared.tsx takes
// the LAST token, which silently renames "Alejandra Salazar Bengoechea"
// to "Bengoechea". Use THIS helper for any surface where operators or
// the social team scan rosters.
//
// Heuristic — known trade-off: compound first names ("Juan Carlos
// Ruiz Diaz") get the second token ("Carlos") rather than the paternal
// surname. Rare; still visually disambiguates.

export function playerShortName(name: string | null | undefined): string {
  if (!name) return '—'
  const trimmed = name.trim()
  if (!trimmed) return '—'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[1]
  // 3+ tokens: paternal surname is token[1]
  return parts[1]
}
