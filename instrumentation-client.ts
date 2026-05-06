// instrumentation-client.ts
//
// Next.js 16 client-side instrumentation entry point. Body code runs
// once on init, before the app becomes interactive.
//
// PostHog + Sentry SDK init lives in src/lib/analytics-init.ts so the
// ConsentBanner can call the same helper when the user opts in mid-
// session — avoiding a forced reload to start sending events.

import * as Sentry from '@sentry/nextjs'
import { initAnalyticsIfAllowed } from '@/lib/analytics-init'

initAnalyticsIfAllowed()

// Surfaced regardless of whether Sentry actually initialised — the SDK
// function is a safe no-op when init() didn't fire. Wiring this up
// means client-side route changes get clean transaction boundaries
// when (and only when) consent is granted.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
