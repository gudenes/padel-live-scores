/** Pull a usable banner id from ?id=. Returns null when absent / blank. */
export function parsePreviewId(raw: string | null): string | null {
  const id = (raw ?? '').trim()
  return id || null
}
