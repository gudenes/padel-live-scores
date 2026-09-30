// apps/ops/src/lib/posthog/hogql.ts
// Minimal server-side client for PostHog's HogQL query API.
// Needs a READ-ONLY personal API key (never the public project key).
//   POSTHOG_PERSONAL_API_KEY  required
//   POSTHOG_PROJECT_ID        required
//   POSTHOG_HOST              optional, default https://eu.posthog.com

export type HogqlRow = unknown[]
export type HogqlRunner = (query: string) => Promise<HogqlRow[]>

const TIMEOUT_MS = 60_000

export class PosthogConfigError extends Error {}

export function hogqlRunnerFromEnv(env: NodeJS.ProcessEnv = process.env): HogqlRunner {
  const key = env.POSTHOG_PERSONAL_API_KEY
  const project = env.POSTHOG_PROJECT_ID
  if (!key || !project) {
    throw new PosthogConfigError('POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID must be set')
  }
  const host = (env.POSTHOG_HOST ?? 'https://eu.posthog.com').replace(/\/$/, '')

  return async (query: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`PostHog query failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
      }
      const json = (await res.json()) as { results?: HogqlRow[] }
      return json.results ?? []
    } finally {
      clearTimeout(timer)
    }
  }
}
