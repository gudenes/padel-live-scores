/**
 * notify — fire-and-forget POST to padelnachos.com's `/api/push/notify` so
 * bookmark + player-follow push notifications go out the moment padelgod
 * flips a match out of `scheduled`.
 *
 * Why this exists
 * ---------------
 * `/api/push/notify` in the Next.js app writes `user_notifications` rows
 * and sends web-push payloads to every user who bookmarked the match or
 * follows one of its players. The Vercel scores + sync crons call it when
 * THEY observe `scheduled → live`. But when padelgod wins the write race
 * (common — live-poller ticks every few seconds, Vercel crons every 2 min
 * or hourly, and Vercel crons also get rate-limited by padelapi), the
 * transition lands in the DB silently and no one is notified. Incident
 * 2026-04-23: `fd345282` (Brussels P2 women R16) went live at 15:26 UTC
 * via padelgod, both Vercel crons were rate-limited, zero users got a
 * push despite active bookmarks.
 *
 * Behavior
 * --------
 * - Called from live-poller-loop right after `public.matches.status`
 *   transitions FROM `scheduled` TO `on_court` or `live`. Only the first
 *   transition per match triggers notify — no spam on `on_court → live`
 *   or per-tick heartbeats.
 * - Fire-and-forget: returns immediately. Network/server errors logged
 *   at `warn`, never thrown. The live-poller tick never blocks on this.
 * - No-op when `NOTIFY_BASE_URL` or `CRON_SECRET` env vars are missing,
 *   so local + test runs don't need them. Production sets both on
 *   Railway.
 * - No local dedup — the notify endpoint already dedups per-user inside
 *   a single call. Double-sends across padelgod + Vercel crons are
 *   theoretically possible if both race the same transition; the notify
 *   endpoint's lack of DB-level dedup is a known tradeoff (in-app row
 *   gets written twice, push gets sent twice). Accepted for now —
 *   observed collision rate is near zero.
 */

import type { Logger } from 'pino';

export interface NotifyDeps {
  baseUrl: string | undefined;
  cronSecret: string | undefined;
  logger: Logger;
  // Injectable for tests — defaults to global fetch.
  fetchImpl?: typeof fetch;
}

/**
 * Fire-and-forget — returns immediately, never throws.
 *
 * Resolves once the fetch POST is dispatched (not once the response
 * arrives). The response handling runs as a detached promise so callers
 * can `void notifyLiveTransition(...)` without awaiting.
 */
export function notifyLiveTransition(
  matchId: string,
  deps: NotifyDeps,
): void {
  const { baseUrl, cronSecret, logger } = deps;
  if (!baseUrl || !cronSecret) {
    // Env not configured — silent no-op. Production should always have these.
    return;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/push/notify`;
  const fetchImpl = deps.fetchImpl ?? fetch;

  // Detached — we don't await, don't return the promise.
  fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ matchId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable>');
        logger.warn(
          { matchId, status: res.status, body: body.slice(0, 500) },
          'notify: push-notify endpoint returned non-ok',
        );
      } else {
        logger.info({ matchId }, 'notify: fired push-notify for live transition');
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ matchId, err: message }, 'notify: push-notify fetch failed');
    });
}
