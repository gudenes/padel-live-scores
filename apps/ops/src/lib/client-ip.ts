// apps/ops/src/lib/client-ip.ts
//
// Mirror of src/lib/client-ip.ts (main Next.js app). apps/ops is a separate
// npm package and doesn't share imports with the main app — same trade-off
// used by `db-paginate.ts` and `feed-scoring.ts`. Keep this file
// BYTE-IDENTICAL with the main-app copy except for this header. If you edit
// one, mirror the other.
//
// Resolve the true client IP from request headers, post-Cloudflare cutover.
//
// WHY this exists: on Vercel, `x-forwarded-for` was *replaced* by the edge
// with the real client IP, so `xff.split(',')[0]` was safe. Cloudflare
// *appends* to whatever the client sent, so the FIRST entry of
// `x-forwarded-for` is attacker-controlled — any caller can send
// `X-Forwarded-For: 1.2.3.4` and rotate it per request, which silently
// bypasses every per-IP rate limit we have.
//
// Preference order:
//   1. `cf-connecting-ip` — written by Cloudflare, cannot be spoofed by the
//      client (CF strips/overwrites any inbound copy). This is the one to trust.
//   2. `x-real-ip` — set by our own reverse proxy layer.
//   3. LAST entry of `x-forwarded-for` — the hop appended closest to us, i.e.
//      the value our nearest trusted proxy observed. Never the first entry.
//   4. null — unknown; callers decide their own fallback (usually '0.0.0.0'
//      or 'unknown' so the rate-limit key still exists).

/** Headers-like: `Headers`, or anything exposing a `get(name)`. */
type HeaderSource = { get(name: string): string | null } | null | undefined

export function getClientIp(headers: HeaderSource): string | null {
  const read = (name: string): string | null => {
    const value = headers?.get?.(name)
    return value ? value.trim() : null
  }

  const cf = read('cf-connecting-ip')
  if (cf) return cf

  const real = read('x-real-ip')
  if (real) return real

  // Take the LAST hop, not the first: everything before it may have been
  // supplied by the client itself.
  const forwarded = read('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return null
}
