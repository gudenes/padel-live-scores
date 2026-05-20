// In-memory rate limiter per (key) over a sliding window.
// Per spec § "Rate limiting": good-enough deterrence on a single Vercel instance,
// not real abuse protection. Move to Upstash Redis if the threat model evolves.

type Entry = { timestamps: number[] }

const buckets = new Map<string, Entry>()

export function check(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const cutoff = now - windowMs
  const entry = buckets.get(key) ?? { timestamps: [] }
  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
  if (entry.timestamps.length >= max) {
    buckets.set(key, entry)
    return { allowed: false, remaining: 0 }
  }
  entry.timestamps.push(now)
  buckets.set(key, entry)
  return { allowed: true, remaining: max - entry.timestamps.length }
}

// Test-only — exported with `_` prefix to discourage runtime use.
export function _reset() {
  buckets.clear()
}
