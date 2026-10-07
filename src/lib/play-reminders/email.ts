import { reminderCopy, appBase, appPath, type ReminderLocale } from './copy'
import type { ReminderMatch, ReminderPlayer } from './plan'
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ]!)
  )
export const REMINDER_HERO_PATH = '/play/email/match-day-hero-v1.jpg'
export function buildReminderEmail(opts: {
  matches: ReminderMatch[]
  locale: ReminderLocale
  timezone: string
  unsubscribeUrl: string
  heroUrl?: string
}) {
  const c = reminderCopy[opts.locale],
    e = escapeHtml,
    settings =
      appBase + appPath(opts.locale, '/profile/settings/notifications'),
    play = appBase + appPath(opts.locale, '/play')
  const names = (p: ReminderPlayer[]) => p.map((x) => x.name).join(' / ')
  const time = (m: ReminderMatch) =>
    new Intl.DateTimeFormat(opts.locale, {
      timeZone: opts.timezone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(m.startsAt))
  // Matches provide sporting context. One main CTA opens all available predictions.
  const fixtures = opts.matches
    .map(
      (m) =>
        `<tr><td style="padding:14px 0;border-top:1px solid #304036"><p style="margin:0 0 5px;color:#a4b4aa;font-size:11px;line-height:1.4">${e(
          m.tournament
        )} · ${e(m.round)} · ${m.category === 'women' ? c.women : c.men} · ${e(
          time(m)
        )}</p><p style="margin:0;font-size:14px;line-height:1.5;font-weight:bold"><span style="color:#ff9b69">${e(
          names(m.pair1)
        )}</span><span style="color:#9aad9f;font-weight:normal"> vs </span><span style="color:#a9ef57">${e(
          names(m.pair2)
        )}</span></p></td></tr>`
    )
    .join('')
  const hero = opts.heroUrl ?? appBase + REMINDER_HERO_PATH
  const html = `<!doctype html><html lang="${
    opts.locale
  }"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${e(
    c.subject
  )}</title></head><body style="margin:0;background:#090e0b;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${e(
    c.intro
  )}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111713;border-top:4px solid #85dc20"><tr><td style="padding:20px 24px"><img src="${appBase}/padelnachos-logo-v2.png" width="108" alt="Padel Nachos" style="display:block;width:108px;height:auto"></td></tr><tr><td><img src="${e(
    hero
  )}" width="560" alt="${e(
    c.heroAlt
  )}" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr><tr><td align="center" style="padding:24px 28px 26px"><p style="margin:0 0 12px;color:#a3eb4c;font-size:10px;font-weight:bold;letter-spacing:2px">${
    c.eyebrow
  }</p><h1 style="margin:0;color:#f5f1e5;font-size:30px;line-height:1.13;letter-spacing:-.6px">${c.title
    .split('\n')
    .map(e)
    .join(
      '<br>'
    )}</h1><p style="margin:14px 0 22px;color:#becac1;font-size:15px;line-height:1.6">${e(
    c.intro
  )}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:400px"><tr><td align="center" bgcolor="#83d51b" style="border-bottom:5px solid #416e0d"><a data-reminder-cta="primary" href="${play}" style="display:block;padding:17px 12px;font-size:13px;line-height:1.3;font-weight:bold;color:#101809;text-decoration:none;text-transform:uppercase;letter-spacing:.3px">${e(
    c.pick
  )} →</a></td></tr></table></td></tr><tr><td style="padding:0 28px 16px"><p style="margin:0 0 4px;color:#e9eee7;font-size:12px;font-weight:bold;letter-spacing:.5px">${e(
    c.lineup
  )}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fixtures}</table></td></tr><tr><td align="center" style="padding:18px 24px;border-top:1px solid #304036;font-size:10px;line-height:1.8;color:#91a497">Padel Nachos · Padel Predict<br>${e(
    c.footer
  )}<br><a href="${settings}" style="color:#a7b7ad;text-decoration:underline">${e(
    c.manage
  )}</a> · <a href="${e(
    opts.unsubscribeUrl
  )}" style="color:#a7b7ad;text-decoration:underline">${e(
    c.unsubscribe
  )}</a></td></tr></table></td></tr></table></body></html>`
  const text = [
    c.title.replace('\n', ' '),
    c.intro,
    `${c.pick}: ${play}`,
    c.lineup,
    ...opts.matches.map(
      (m) =>
        `${m.tournament} · ${m.round} · ${time(m)}\n${names(
          m.pair1
        )} vs ${names(m.pair2)}`
    ),
    `${c.manage}: ${settings}`,
    `${c.unsubscribe}: ${opts.unsubscribeUrl}`,
  ].join('\n\n')
  return { subject: c.subject, html, text }
}
