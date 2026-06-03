// src/lib/broadcast-push.ts
// Dependency-injected broadcast fan-out. The route supplies real Supabase-
// backed deps; tests supply fakes. Knows nothing about HTTP or the DB.

import type { PushPayload } from './push'
import type { FcmSendResult } from './push-fcm'

export interface WebSub {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface BroadcastInput {
  title: string
  body: string
  url?: string
  icon?: string
  /** notification_sends.id, embedded in each payload for click attribution. */
  sendId?: string
  dryRun?: boolean
}
// Note: a campaign `label` is NOT part of the push payload — it lives only on
// the notification_sends DB row and is set by the route at insert time.

type WebSendFn = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload) => Promise<boolean>

export interface BroadcastDeps {
  fetchWebSubs: () => Promise<WebSub[]>
  fetchFcmTokens: () => Promise<string[]>
  fetchAnonSubs: () => Promise<WebSub[]>
  /** Web-push (VAPID) sender. Used for BOTH authenticated web subs and
   *  anonymous web subs — they share the same transport. */
  sendWeb: WebSendFn
  sendFcm: (tokens: string[], payload: PushPayload) => Promise<FcmSendResult>
  cleanupWebStale: (ids: string[]) => Promise<void>
  cleanupFcmStale: (tokens: string[]) => Promise<void>
  cleanupAnonStale: (ids: string[]) => Promise<void>
}

export interface WebChannelCounts { fired: number; accepted: number; stale: number }
// `failed` is the total FCM failure count; `stale` (unregistered/invalid
// tokens) is a SUBSET of `failed`, not additive. So accepted + failed = fired,
// and stale ≤ failed. Don't sum failed + stale.
export interface FcmChannelCounts { fired: number; accepted: number; failed: number; stale: number }

export interface BroadcastResult {
  web: WebChannelCounts
  fcm: FcmChannelCounts
  anon: WebChannelCounts
  recipients_total: number
  accepted_total: number
  dry_run: boolean
}

const CONCURRENCY = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function sendWebChannel(
  subs: WebSub[],
  payload: PushPayload,
  send: WebSendFn,
  cleanup: (ids: string[]) => Promise<void>,
): Promise<WebChannelCounts> {
  const staleIds: string[] = []
  let accepted = 0
  for (const batch of chunk(subs, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((s) =>
        send({ endpoint: s.endpoint, keys: s.keys }, payload).then((ok) => ({ ok, id: s.id })),
      ),
    )
    for (const r of results) {
      if (r.ok) accepted++
      else staleIds.push(r.id)
    }
  }
  if (staleIds.length) await cleanup(staleIds)
  return { fired: subs.length, accepted, stale: staleIds.length }
}

export async function runBroadcast(input: BroadcastInput, deps: BroadcastDeps): Promise<BroadcastResult> {
  const payload: PushPayload = {
    title: input.title,
    body: input.body,
    url: input.url || '/',
    tag: 'broadcast',
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.sendId ? { sendId: input.sendId } : {}),
  }

  const [webSubs, fcmTokens, anonSubs] = await Promise.all([
    deps.fetchWebSubs(),
    deps.fetchFcmTokens(),
    deps.fetchAnonSubs(),
  ])

  if (input.dryRun) {
    return {
      web: { fired: webSubs.length, accepted: 0, stale: 0 },
      fcm: { fired: fcmTokens.length, accepted: 0, failed: 0, stale: 0 },
      anon: { fired: anonSubs.length, accepted: 0, stale: 0 },
      recipients_total: webSubs.length + fcmTokens.length + anonSubs.length,
      accepted_total: 0,
      dry_run: true,
    }
  }

  // Web and anon both go over web-push (deps.sendWeb), with their own
  // cleanup targets for stale endpoints.
  const web = await sendWebChannel(webSubs, payload, deps.sendWeb, deps.cleanupWebStale)
  const anon = await sendWebChannel(anonSubs, payload, deps.sendWeb, deps.cleanupAnonStale)

  let fcm: FcmChannelCounts = { fired: fcmTokens.length, accepted: 0, failed: 0, stale: 0 }
  if (fcmTokens.length) {
    const res = await deps.sendFcm(fcmTokens, payload)
    fcm = { fired: fcmTokens.length, accepted: res.success, failed: res.failed, stale: res.invalidTokens.length }
    if (res.invalidTokens.length) await deps.cleanupFcmStale(res.invalidTokens)
  }

  const recipients_total = web.fired + fcm.fired + anon.fired
  const accepted_total = web.accepted + fcm.accepted + anon.accepted
  return { web, fcm, anon, recipients_total, accepted_total, dry_run: false }
}

/** Flatten a BroadcastResult into the notification_sends count columns. */
export function resultToCountsRow(r: BroadcastResult) {
  return {
    web_fired: r.web.fired,
    web_accepted: r.web.accepted,
    web_stale: r.web.stale,
    fcm_fired: r.fcm.fired,
    fcm_accepted: r.fcm.accepted,
    fcm_failed: r.fcm.failed,
    fcm_stale: r.fcm.stale,
    anon_fired: r.anon.fired,
    anon_accepted: r.anon.accepted,
    anon_stale: r.anon.stale,
    recipients_total: r.recipients_total,
    accepted_total: r.accepted_total,
  }
}
