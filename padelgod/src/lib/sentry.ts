// padelgod/src/lib/sentry.ts
//
// Sentry init for the Railway-deployed Node service. Captures uncaught
// exceptions, unhandled promise rejections, and (when transactions are
// enabled at the per-call level) explicit performance traces.
//
// Mirrors the Vercel-side posture in sentry.server.config.ts:
//   - No-op when SENTRY_DSN is unset (safe local dev / first deploy)
//   - 10% perf sampling
//   - sendDefaultPii=false (GDPR-aware default)
//   - Only enabled in real envs (production, staging, or with the
//     SENTRY_FORCE_ENABLED override for testing)
//
// The two scheduled-cron-style use cases that matter most for this
// service:
//
//   1. Worker throws unhandled — `runStaticReconciler`, the writers,
//      etc. wrap their work in try/catch but catch-all wrapping isn't
//      perfect. A bug like the env-coercion regression would otherwise
//      die silently in Railway logs.
//
//   2. Cron miss — Sentry's "Crons" feature can be wired up by
//      calling `Sentry.cron.MongoCron.instrumentCron(...)` per worker.
//      Not done in this PR — left for a follow-up so we don't bloat
//      the diff. For now we just get exception capture.

import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Don't even import the SDK side-effects when DSN is missing.
    // Sentry.init({ dsn: undefined }) is technically a no-op already
    // but explicit here makes the intent obvious.
    return;
  }

  // Only emit traffic when we explicitly want to. Mirrors the Vercel
  // side's `enabled` flag.
  const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
  const nodeEnv = process.env.NODE_ENV;
  const allowed =
    railwayEnv === 'production'
    || railwayEnv === 'staging'
    || nodeEnv === 'production'
    || process.env.SENTRY_FORCE_ENABLED === '1';
  if (!allowed) return;

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT
      ?? railwayEnv
      ?? nodeEnv
      ?? 'development',
    release:
      process.env.SENTRY_RELEASE
      ?? process.env.RAILWAY_GIT_COMMIT_SHA
      ?? undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    // Service-name tag so Sentry can filter padelgod errors apart
    // from the Vercel app's errors when they share an org.
    initialScope: {
      tags: { service: 'padelgod' },
    },
    ignoreErrors: [
      // Padelapi rate-limit retries surface as known errors we
      // already log with `[Sync] 429 — backing off`. No value in
      // routing them to Sentry.
      /padelapi.*429/i,
    ],
  });
}
