// src/lib/with-timeout.ts
// Race a promise against a timeout. Used to prevent UI loading states
// from hanging forever when supabase queries stall (e.g. during auth
// token refresh deadlocks).

export function withTimeout<T>(
  promise: Promise<T>,
  ms = 10_000,
  label = 'query'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}
