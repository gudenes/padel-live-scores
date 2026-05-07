// apps/labs/instrumentation.ts
//
// Intentionally empty — shadows the repo-root instrumentation.ts (Padel
// Nachos's Sentry hook). Without this file, Next.js's instrumentation
// discovery walks up to the repo root and tries to bundle `@sentry/nextjs`,
// which is not a Padel Labs dependency. Next.js finds this file first and
// stops walking up.
//
// Phase 2 (and v1 broadly) doesn't ship Sentry on Padel Labs. If we want
// Sentry here later, we install the dep + populate this hook the same way
// Padel Nachos does.

export function register() {
  // no-op
}
