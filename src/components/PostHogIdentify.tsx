'use client'

// src/components/PostHogIdentify.tsx
//
// Promotes the anonymous PostHog `distinct_id` to the authenticated user
// on login, and resets back to a fresh anonymous id on logout. Without
// this hook, every signed-in session shows up as a stranger and we lose
// the ability to follow a single person across devices.
//
// Why it lives in a separate component (not inside instrumentation-client.ts):
// the SDK init runs once at boot, before AuthProvider is on the tree.
// Identify needs to react to user changes, which only React can observe.

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { useAuth } from '@/components/AuthProvider'

export function PostHogIdentify() {
  const { user } = useAuth()

  useEffect(() => {
    // Skip when SDK was never initialized (env var missing in dev / PR
    // previews, or user opted out via `pn_analytics_opt_out`). The
    // `config` property is only set by posthog.init() — using its
    // presence as the readiness check avoids calling identify() before
    // the SDK is wired up, which would silently no-op anyway but emits
    // confusing console warnings.
    if (!posthog.config) return

    if (user) {
      posthog.identify(user.id, {
        // Send minimum-viable identifying properties. PostHog person
        // profiles can hold whatever the dashboards filter on later,
        // so this set is intentionally small — easier to expand than
        // to retroactively scrub fields we didn't need.
        email: user.email ?? undefined,
      })
    } else {
      // On logout, throw away the alias so the next anonymous session
      // doesn't get stitched into the previous user's profile.
      posthog.reset()
    }
  }, [user])

  return null
}
