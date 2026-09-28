// Play the Next — server-side access control.
//
// The feature is deployed to production but visible only to whitelisted
// users. Access requires BOTH:
//   1. the `play_enabled` feature flag (global kill switch)
//   2. a row in `play_access` for this user
//
// Everything here is server-only and uses the service-role client. The
// browser must never be the thing deciding whether you have access:
// hiding the nav tab is presentation, this is the gate.
//
// Why not RLS? The app authenticates with Auth.js, not Supabase Auth, so
// `auth.uid()` is NULL for a logged-in user and every auth.uid()-based
// policy denies. See supabase/migrations/20260415_authjs_tables.sql.

import { headers } from 'next/headers'
import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Flag key, mirroring the row seeded in 20260924100000_play_access_whitelist.sql. */
export const PLAY_ENABLED_FLAG = 'play_enabled'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

/**
 * Private (RFC 1918) addresses — 10/8, 172.16/12, 192.168/16.
 *
 * Testing on a phone means hitting the dev server by its LAN address, which
 * is not `localhost`, so the strict list above would send those requests to
 * the PRODUCTION flag column and 404 the whole feature.
 *
 * This only ever applies outside production (see `isLocalRequest`). Accepting
 * it in a production build would let anyone flip which flag column governs
 * by forging a Host header — the per-user whitelist would still deny them,
 * but the global kill switch would stop being trustworthy, and a kill switch
 * you cannot trust is worse than none.
 */
// Anchored at BOTH ends on purpose. A prefix-only pattern also matches
// `192.168.0.215.evil.com`, which is a hostname anyone can register — caught
// by the unit test below, not by review.
const OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`
const PRIVATE_IP = new RegExp(
  `^(?:10\\.${OCTET}\\.${OCTET}|127\\.${OCTET}\\.${OCTET}|192\\.168\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])\\.${OCTET})\\.${OCTET}$`,
)

/**
 * Local dev and production share ONE Supabase project, so a single `enabled`
 * column cannot mean "on for me, off for everyone" — switching it on to test
 * locally would switch it on in production too.
 *
 * `feature_flags` already solves this with a second `enabled_local` column;
 * the client helper in src/lib/feature-flags.ts picks between them using
 * `window.location.hostname`. There's no window here, so we read the Host
 * header instead.
 *
 * The header is attacker-controlled in principle. It is not a security
 * boundary here: picking the wrong column only chooses which flag governs,
 * and the per-user whitelist still has to pass either way.
 */
async function isLocalRequest(): Promise<boolean> {
  try {
    const host = (await headers()).get('host') ?? ''
    const hostname = host.split(':')[0]
    if (LOCAL_HOSTS.has(hostname)) return true
    // LAN addresses count as local ONLY in a dev build — never in production.
    return process.env.NODE_ENV !== 'production' && PRIVATE_IP.test(hostname)
  } catch {
    // headers() throws outside a request scope. Treat that as production.
    return false
  }
}

/**
 * Is the feature switched on at all?
 *
 * Deliberately fails CLOSED: a missing row, a query error, or a NULL value
 * all resolve to `false`. A whitelist that opens up when the database
 * hiccups is not a whitelist.
 */
export async function isPlayEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('enabled, enabled_local')
    .eq('key', PLAY_ENABLED_FLAG)
    .maybeSingle()

  if (error) {
    console.warn('[play-access] flag lookup failed, denying:', error.message)
    return false
  }
  if (!data) return false

  const row = data as { enabled: boolean | null; enabled_local: boolean | null }
  return ((await isLocalRequest()) ? row.enabled_local : row.enabled) === true
}

/**
 * Is this specific user on the allowlist? Assumes the caller already
 * established the user is authenticated.
 */
export async function isWhitelisted(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('play_access')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[play-access] whitelist lookup failed, denying:', error.message)
    return false
  }
  return data != null
}

export interface PlayAccessGrant {
  userId: string
  supabase: SupabaseClient
}

/**
 * The single chokepoint. Returns the user + a service client when access is
 * granted, or `null` for every failure mode — logged out, flag off, not
 * whitelisted, or an error looking any of that up.
 *
 * Callers must not distinguish between those cases in what they render or
 * return. A non-whitelisted user should not be able to tell the difference
 * between "this feature is off for you" and "this route does not exist";
 * both are a 404. Otherwise the 403 itself advertises the feature.
 */
export async function requirePlayAccess(): Promise<PlayAccessGrant | null> {
  // Collapsing every failure into one silent null is correct for users and
  // miserable for whoever is trying to work out why their own account 404s.
  // This names the failing check on the SERVER CONSOLE, in development only,
  // so the response the user sees is byte-identical either way.
  const deny = (reason: string): null => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[play-access] denied: ${reason}`)
    }
    return null
  }

  const session = await auth().catch(() => null)
  const userId = session?.user?.id
  if (!userId) return deny('not signed in')

  const supabase = createServiceClient()

  // Sequential rather than parallel: the flag is the cheaper, more commonly
  // false check, and skipping the per-user lookup when the feature is off
  // keeps a disabled feature from generating one query per request.
  if (!(await isPlayEnabled(supabase))) {
    return deny(
      `play_enabled flag is off for this host (local=${await isLocalRequest()})`,
    )
  }
  if (!(await isWhitelisted(supabase, userId))) {
    return deny(`user ${userId} is not in play_access`)
  }

  return { userId, supabase }
}
