import type { NotifyDeps } from '../lib/notify.js'
export async function runPlayReminderDispatch(deps: {
  notify?: NotifyDeps
  dryRun?: boolean
  fetchImpl?: typeof fetch
}) {
  const config = deps.notify
  if (!config?.baseUrl || !config.cronSecret) return { skipped: true }
  const r = await (deps.fetchImpl ?? fetch)(
    `${config.baseUrl.replace(/\/$/, '')}/api/internal/play-reminders`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cronSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dryRun: deps.dryRun ?? false }),
      signal: AbortSignal.timeout(110000),
    }
  )
  if (!r.ok) throw Error(`Play reminder dispatch failed (${r.status})`)
  return (await r.json()) as Record<string, unknown>
}
