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
function imageUrl(url: string | null) {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'https:' ? escapeHtml(u.href) : null
  } catch {
    return null
  }
}
function players(ps: ReminderPlayer[], color: string) {
  return ps
    .map((p) => {
      const src = imageUrl(p.image)
      const style = `width:48px;height:48px;border-radius:50%;border:2px solid ${color};display:inline-block;margin-right:5px`
      return src
        ? `<img src="${src}" width="48" height="48" alt="${escapeHtml(
            p.name
          )}" style="${style};object-fit:cover">`
        : `<span aria-label="${escapeHtml(
            p.name
          )}" style="${style};background:#26312a;color:#f5f1e5;text-align:center;line-height:48px;font-weight:bold">${escapeHtml(
            p.name.slice(0, 2).toUpperCase()
          )}</span>`
    })
    .join('')
}
export function buildReminderEmail(opts: {
  matches: ReminderMatch[]
  locale: ReminderLocale
  timezone: string
  unsubscribeUrl: string
}) {
  const c = reminderCopy[opts.locale],
    e = escapeHtml,
    settings =
      appBase + appPath(opts.locale, '/profile/settings/notifications'),
    all = appBase + appPath(opts.locale, '/play')
  const names = (p: ReminderPlayer[]) => p.map((x) => x.name).join(' / ')
  const cards = opts.matches
    .map((m) => {
      const time = new Intl.DateTimeFormat(opts.locale, {
        timeZone: opts.timezone,
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(m.startsAt))
      const href =
        appBase +
        appPath(opts.locale, `/play?match=${encodeURIComponent(m.matchId)}`)
      return `<tr><td style="padding:0 24px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#19201d;border:1px solid #354238;border-bottom:5px solid #080d09"><tr><td style="padding:20px"><p style="margin:0 0 16px;color:#adc0bc;font-size:11px;font-weight:bold;letter-spacing:.6px">${e(
        m.tournament
      )} · ${e(m.round)} · ${
        m.category === 'women' ? c.women : c.men
      }</p><table role="presentation" width="100%"><tr><td width="45%">${players(
        m.pair1,
        '#ff7135'
      )}</td><td align="center" style="color:#a0b3aa;font-weight:bold">VS</td><td width="45%" align="right">${players(
        m.pair2,
        '#88df1c'
      )}</td></tr></table><table role="presentation" width="100%"><tr><td width="48%" style="color:#ff9b69;font-size:15px;font-weight:bold;padding-top:10px">${e(
        names(m.pair1)
      )}</td><td width="4%"></td><td width="48%" align="right" style="color:#a9ef57;font-size:15px;font-weight:bold;padding-top:10px">${e(
        names(m.pair2)
      )}</td></tr></table><p style="margin:16px 0;color:#bdc8bf;font-size:12px">${e(
        time
      )}</p>${m.markets
        .map(
          (q) =>
            `<p style="margin:0;padding:10px 0;border-top:1px solid #354238;color:#f5f1e5;font-size:14px;line-height:1.5"><span style="color:#a9ef57">›</span> ${e(
              q.question
            )}</p>`
        )
        .join(
          ''
        )}<table role="presentation" width="100%" style="margin-top:15px"><tr><td align="center" bgcolor="#83d51b" style="border-bottom:5px solid #416e0d"><a href="${e(
        href
      )}" style="display:block;padding:15px 8px;font-weight:bold;font-size:13px;color:#101809;text-decoration:none;text-transform:uppercase">${
        c.pick
      } →</a></td></tr></table></td></tr></table></td></tr>`
    })
    .join('')
  const html = `<!doctype html><html lang="${
    opts.locale
  }"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${e(
    c.subject
  )}</title></head><body style="margin:0;background:#0b0f0d;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${e(
    c.intro
  )}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111713"><tr><td style="padding:28px 24px;border-top:5px solid #85dc20"><img src="${appBase}/padelnachos-logo-v2.png" width="116" alt="Padel Nachos" style="display:block"><p style="margin:28px 0 12px;color:#a3eb4c;font-size:11px;font-weight:bold;letter-spacing:2px">${
    c.eyebrow
  }</p><h1 style="margin:0;font-size:36px;line-height:1.08;color:#f5f1e5">${c.title
    .split('\n')
    .map(e)
    .join(
      '<br>'
    )}</h1><p style="color:#bac8be;font-size:15px;line-height:1.6;margin:18px 0 0">${e(
    c.intro
  )}</p></td></tr>${cards}<tr><td align="center" style="padding:0 24px 28px"><a href="${all}" style="color:#a9ef57;font-weight:bold;font-size:13px">${
    c.all
  } →</a></td></tr><tr><td style="padding:24px;border-top:1px solid #354238;font-size:11px;line-height:1.8;color:#9caca2"><img src="${appBase}/play/currency/guaca-game-v1.png" width="24" height="24" alt="Guaca" style="vertical-align:middle;margin-right:6px"> Padel Nachos · Padel Predict<br>${e(
    c.footer
  )}<br><a href="${settings}" style="color:#bbc7be">${
    c.manage
  }</a> · <a href="${e(opts.unsubscribeUrl)}" style="color:#bbc7be">${
    c.unsubscribe
  }</a></td></tr></table></td></tr></table></body></html>`
  const text = [
    c.title.replace('\n', ' '),
    c.intro,
    ...opts.matches.map(
      (m) =>
        `${m.tournament} · ${m.round}\n${names(m.pair1)} vs ${names(
          m.pair2
        )}\n${new Intl.DateTimeFormat(opts.locale, {
          timeZone: opts.timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(m.startsAt))}\n${m.markets
          .map((q) => q.question)
          .join('\n')}\n${
          appBase + appPath(opts.locale, `/play?match=${m.matchId}`)
        }`
    ),
    `${c.manage}: ${settings}`,
    `${c.unsubscribe}: ${opts.unsubscribeUrl}`,
  ].join('\n\n')
  return { subject: c.subject, html, text }
}
