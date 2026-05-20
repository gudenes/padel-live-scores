// apps/ops/instrumentation.ts
//
// Intentionally empty — shadows the repo-root instrumentation.ts (Padel
// Nachos's Sentry hook). Without this file, Next.js's instrumentation
// discovery walks up to the repo root and tries to bundle `@sentry/nextjs`,
// which is not a Padel Ops dependency. Next.js finds this file first and
// stops walking up.
//
// Phase 1 of the admin ops app doesn't ship Sentry. If we want Sentry
// here later, we install the dep + populate this hook the same way Padel
// Nachos does (see /instrumentation.ts at the repo root).

export function register() {
  // no-op
}
