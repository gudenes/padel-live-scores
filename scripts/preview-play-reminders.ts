// Render previews only. No delivery claims, preference writes or outbound sends.
import { mkdir, writeFile } from 'node:fs/promises'
import { createServiceClient } from '../src/lib/supabase'
import { loadReminderMarkets } from '../src/lib/play-reminders/data'
import {
  planReminder,
  type ReminderMarket,
} from '../src/lib/play-reminders/plan'
import { buildReminderEmail } from '../src/lib/play-reminders/email'
const db = createServiceClient(),
  timezone = 'Europe/Madrid'
async function main() {
  const en = await loadReminderMarkets(db, 'en', Date.now())
  if (!en.length)
    throw Error('No open match markets available for a real-data preview')
  const first = en.sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  )[0]
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(first.startsAt))
  // Preview at morning on the first available match day; do not change live data.
  const now = Date.parse(`${date}T07:00:00Z`)
  const out = 'output/play-reminder-email'
  await mkdir(out, { recursive: true })
  for (const locale of ['en', 'es', 'pt', 'fr', 'it'] as const) {
    const rows = await loadReminderMarkets(db, locale, Date.now())
    const matches = planReminder({
      markets: rows as ReminderMarket[],
      answered: new Set(),
      followed: new Set(),
      bookmarked: new Set(),
      timezone,
      channel: 'email',
      now,
    })
    if (!matches.length) throw Error('Preview has no morning matches')
    const e = buildReminderEmail({
      matches,
      locale,
      timezone,
      unsubscribeUrl: 'https://padelnachos.com/profile/settings/notifications',
    })
    await writeFile(`${out}/${locale}.html`, e.html)
  }
  await writeFile(
    `${out}/index.html`,
    `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#090d0b;color:#eee;font:14px Arial"><nav style="padding:14px;text-align:center">EMAIL PREVIEW · REAL MATCH DATA · NO EMAILS SENT &nbsp; ${[
      'en',
      'es',
      'pt',
      'fr',
      'it',
    ]
      .map(
        (l) =>
          `<a href="${l}.html" target="email" style="color:#a9ef57;margin:0 8px">${l.toUpperCase()}</a>`
      )
      .join(
        ''
      )}</nav><iframe name="email" src="en.html" title="Daily padel email" style="width:100%;height:calc(100vh - 50px);border:0"></iframe></body></html>`
  )
  console.log(`Email previews saved to ${out}`)
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
