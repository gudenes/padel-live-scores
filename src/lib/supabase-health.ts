'use client'
// src/lib/supabase-health.ts
//
// Detects when the Supabase client is "wedged" — a state where the auth
// refresh has hung and every subsequent query times out — and triggers
// recovery before the user has to manually refresh.
//
// SYMPTOMS WE'RE DETECTING
// All N queries on a page time out at exactly the per-query timeout
// (10s in most pages). When a single query times out, that's likely a
// slow query or transient network blip. When EVERY query times out at
// the same time, it's the Supabase client being stuck behind a hung
// auth refresh.
//
// RECOVERY STRATEGY
// 1. Try to coax the auth client back to life by calling
//    `supabase.auth.getSession()` with a 4s timeout
// 2. If that succeeds → fine, the next refetch will work
// 3. If that times out → force `window.location.reload()` (the user is
//    already going to do this manually; we just automate it)
// 4. Debounce so we don't reload more than once per minute (prevents
//    refresh loops if something is genuinely broken)

import { supabase } from '@/lib/supabase'

const RECOVERY_DEBOUNCE_MS = 60_000

let lastRecoveryAt = 0
let recoveryInFlight = false

/**
 * Call this when a fetchData attempt has multiple query failures all in
 * one batch. Triggers recovery if needed (debounced).
 *
 * @param failureCount  Number of queries that failed in this batch
 * @param totalCount    Total number of queries attempted in this batch
 * @param context       Label for logging (e.g. "V3 Home", "V3 Scores")
 */
export async function reportBatchFailures(
  failureCount: number,
  totalCount: number,
  context: string
): Promise<void> {
  // Threshold: more than half the queries failed AND at least 3 failed.
  // 3 is the minimum to rule out network blips on individual queries.
  const ratio = totalCount > 0 ? failureCount / totalCount : 0
  if (failureCount < 3 || ratio < 0.5) return

  console.warn(
    `[supabase-health] ${context}: ${failureCount}/${totalCount} queries failed — ` +
    `Supabase client likely wedged`
  )

  // Debounce — don't recover more than once per minute
  const now = Date.now()
  if (recoveryInFlight) {
    console.warn('[supabase-health] recovery already in flight, skipping')
    return
  }
  if (now - lastRecoveryAt < RECOVERY_DEBOUNCE_MS) {
    console.warn(
      `[supabase-health] recovery skipped — last attempt was ` +
      `${Math.round((now - lastRecoveryAt) / 1000)}s ago`
    )
    return
  }

  recoveryInFlight = true
  lastRecoveryAt = now

  try {
    await attemptRecovery(context)
  } finally {
    recoveryInFlight = false
  }
}

/**
 * The actual recovery routine. Tries auth, then a probe query, then
 * escalates to a hard reload if either is broken.
 *
 * The "auth probe + query probe" pair matters: previous evidence shows
 * that supabase.auth.getSession() can resolve fine while the underlying
 * query path is still wedged. Both have to work for us to consider
 * recovery successful.
 */
async function attemptRecovery(context: string): Promise<void> {
  console.warn(`[supabase-health] ${context}: attempting recovery...`)

  // ── Probe 1: auth ──
  const authStart = Date.now()
  let authOk = false
  try {
    await Promise.race([
      supabase.auth.getSession().then(() => { authOk = true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('auth-timeout')), 4_000)),
    ])
  } catch { /* swallow */ }
  console.warn(
    `[supabase-health] probe.auth: ${authOk ? 'ok' : 'TIMED OUT'} ` +
    `(${Date.now() - authStart}ms)`
  )

  // ── Probe 2: tiny query ──
  // If auth.getSession() worked but real queries don't, the client is
  // wedged in a way that recreating the session won't fix.
  const queryStart = Date.now()
  let queryOk = false
  try {
    await Promise.race([
      supabase.from('matches').select('id').limit(1).then(() => { queryOk = true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('query-timeout')), 4_000)),
    ])
  } catch { /* swallow */ }
  console.warn(
    `[supabase-health] probe.query: ${queryOk ? 'ok' : 'TIMED OUT'} ` +
    `(${Date.now() - queryStart}ms)`
  )

  if (authOk && queryOk) {
    console.warn(`[supabase-health] both probes ok — letting next refetch take over`)
    return
  }

  // Either auth or query is wedged. Hard reload is the only reliable
  // recovery — recreating the supabase client mid-session would orphan
  // every page that imported it.
  console.warn(`[supabase-health] client wedged (auth=${authOk} query=${queryOk}) — forcing reload`)
  if (typeof window !== 'undefined') {
    setTimeout(() => window.location.reload(), 200)
  }
}

/**
 * Lightweight session keepalive — pings auth.getSession() periodically
 * to keep the client warm. Call once per app from a top-level component
 * (e.g. AuthProvider).
 *
 * @returns cleanup function to stop the keepalive
 */
export function startSessionKeepalive(intervalMs: number = 5 * 60_000): () => void {
  if (typeof window === 'undefined') return () => {}

  const tick = async () => {
    try {
      const start = Date.now()
      await Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('keepalive-timeout')), 4_000)),
      ])
      const elapsed = Date.now() - start
      if (elapsed > 1000) {
        console.log(`[supabase-health] keepalive ok (${elapsed}ms)`)
      }
    } catch (e) {
      console.warn('[supabase-health] keepalive failed:', (e as Error)?.message)
      // Don't trigger recovery from keepalive — let the next user action
      // surface the issue. Keepalive failure on its own isn't critical.
    }
  }

  const interval = setInterval(tick, intervalMs)
  return () => clearInterval(interval)
}
