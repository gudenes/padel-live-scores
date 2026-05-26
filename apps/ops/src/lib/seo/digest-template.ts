// apps/ops/src/lib/seo/digest-template.ts
// Plain HTML morning digest. ~80 lines. Sent via Resend.

import type { WindowDelta } from './seo-compute'

export interface DigestData {
  digestDate: string                         // e.g. '2026-05-25'
  dataThroughDay: string                     // e.g. '2026-05-22'
  snapshotFetchedAt: string                  // ISO timestamp
  currentClicks: number
  priorClicks: number
  delta: WindowDelta
  localeRows: Array<{
    locale: string
    clicks: number
    priorClicks: number
    deltaPct: number
    direction: 'up' | 'down' | 'flat'
  }>
  bullets: string[]
  dashboardUrl: string
}

const arrow = (d: 'up' | 'down' | 'flat') => d === 'up' ? '▲' : d === 'down' ? '▼' : '—'
const sign = (n: number) => (n > 0 ? '+' : '') + n + '%'

export function buildDigestSubject(d: DigestData, ingestStale: boolean): string {
  if (ingestStale) return `SEO · ingest failed (no fresh data for ${d.digestDate})`
  return `SEO · clicks ${arrow(d.delta.direction)}${Math.abs(d.delta.deltaPct)}% · ${d.currentClicks.toLocaleString()} last 7d`
}

export function buildDigestHtml(d: DigestData): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;color:#111;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;padding:24px;">
    <div style="font-size:14px;opacity:0.6;margin-bottom:8px;">SEO daily · ${d.digestDate}</div>
    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;">Clicks · last 7 days</div>

    <div style="margin:16px 0;">
      <span style="font-size:32px;font-weight:600;">${d.currentClicks.toLocaleString()}</span>
      <span style="font-size:16px;margin-left:12px;color:${d.delta.direction === 'up' ? '#16a34a' : d.delta.direction === 'down' ? '#dc2626' : '#6b7280'};">
        ${arrow(d.delta.direction)} ${Math.abs(d.delta.deltaPct)}%
      </span>
      <div style="font-size:14px;opacity:0.6;margin-top:4px;">vs ${d.priorClicks.toLocaleString()} prior 7d</div>
    </div>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">

    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;margin-bottom:8px;">By locale</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${d.localeRows.map(r => `
        <tr style="border-top:1px solid #f0f0f0;">
          <td style="padding:8px 0;width:60px;">${r.locale}</td>
          <td style="padding:8px 0;text-align:right;">${r.clicks.toLocaleString()}</td>
          <td style="padding:8px 0;text-align:right;color:${r.direction === 'up' ? '#16a34a' : r.direction === 'down' ? '#dc2626' : '#6b7280'};width:80px;">
            ${sign(r.deltaPct)}
          </td>
          <td style="padding:8px 0;text-align:right;opacity:0.5;font-size:12px;width:90px;">(was ${r.priorClicks.toLocaleString()})</td>
        </tr>
      `).join('')}
    </table>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">

    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;margin-bottom:8px;">Worth a look</div>
    <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">
      ${d.bullets.map(b => `<li>${b}</li>`).join('')}
    </ul>

    <div style="margin-top:32px;">
      <a href="${d.dashboardUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:white;border-radius:6px;text-decoration:none;font-size:14px;">
        Open dashboard →
      </a>
    </div>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;">
    <div style="font-size:11px;opacity:0.5;line-height:1.5;">
      Data through ${d.dataThroughDay} (GSC has 2-3d lag).<br>
      Snapshot taken ${d.snapshotFetchedAt} UTC.
    </div>
  </div>
</body></html>`
}
