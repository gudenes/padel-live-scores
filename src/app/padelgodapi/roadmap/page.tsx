// src/app/padelgodapi/roadmap/page.tsx
// What's coming. Includes the Scope B migration + public API plans.

import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { Callout } from '../_components/Callout'
import { PrevNextLinks } from '../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Roadmap' }

interface Milestone {
  when: string
  title: string
  body: string
  status: 'done' | 'next' | 'later'
}

const MILESTONES: Milestone[] = [
  {
    when: 'Shipped',
    title: 'Live scoring cutover for FIP + Premier P2',
    body: 'Shadow mode validated and cut over for Brussels P2 2026 and adjacent tournaments. Point-by-point, serving indicator, and set transitions are now powered by padelgod.',
    status: 'done',
  },
  {
    when: 'Shipped',
    title: 'FIP PDF entry-list pipeline',
    body: 'End-to-end: scrape event page → admin-ajax → entry-list PDFs → parse → resolve players to real fip_ids (local DB + FIP search fallback) → persist to snapshot tables. 100% player resolution on Ijuí validation.',
    status: 'done',
  },
  {
    when: 'Next',
    title: 'Move the FIP entry-list pipeline into padelgod (Scope B)',
    body: 'Currently the pipeline runs on Vercel (Next.js API route). Repeated serverless constraints (DOMMatrix, pdfjs worker loading, missing native APIs) make Vercel the wrong home for heavy scraping work. We\u2019re moving the whole pipeline into the padelgod Railway service — same Node runtime the other scrapers already use. The parent-repo ops endpoint becomes a thin proxy to padelgod.',
    status: 'next',
  },
  {
    when: 'Next',
    title: 'Per-tournament worker scoping',
    body: 'Today every padelgod worker runs against every active tournament. Add a per-tournament invocation mode so the ops UI can bring up a single tournament immediately (draw + OOP + results + reconciler, scoped).',
    status: 'next',
  },
  {
    when: 'Later',
    title: 'Public developer API (v1)',
    body: 'HTTPS + bearer tokens, JSON responses, cursor pagination, rate limits with X-RateLimit-* headers, a self-service dashboard for quota + logs. Read-only to start — tournaments, matches, sets, players, live feed.',
    status: 'later',
  },
  {
    when: 'Later',
    title: 'Webhooks',
    body: 'Subscribe to events: match.started, match.finished, tournament.published, player.ranked. Signed payloads, at-least-once delivery, replay dashboard.',
    status: 'later',
  },
  {
    when: 'Later',
    title: 'A1 Padel + Hexagon Cup integrations',
    body: 'Both tours use different provider stacks than matchscorerlive. Adapter + reconciler work needed.',
    status: 'later',
  },
  {
    when: 'Later',
    title: 'Avatar backfill',
    body: '90% of players in our DB have no avatar. The player-profile worker is stubbed but not batch-driving yet. Bring avatars to parity with padelapi\u2019s coverage.',
    status: 'later',
  },
]

function Badge({ status }: { status: Milestone['status'] }) {
  const map = {
    done: {
      label: 'Shipped',
      className: 'border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success)]',
    },
    next: {
      label: 'Up next',
      className: 'border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
    },
    later: {
      label: 'Later',
      className: 'border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-muted)]',
    },
  }
  const m = map[status]
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.className}`}
    >
      {m.label}
    </span>
  )
}

export default function RoadmapPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Overview"
        title="Roadmap"
        description="What\u2019s shipped, what\u2019s up next, and what\u2019s on the longer horizon. This page is editable — keep it honest and outcome-focused."
      />
      <Prose>
        <h2>Up next</h2>
        <p>
          The immediate focus is ending the Vercel-vs-serverless friction for heavy scraping work by
          migrating the FIP entry-list pipeline into padelgod (&quot;Scope B&quot;), then unlocking
          per-tournament worker invocation so ops can bring up a tournament in minutes rather than
          waiting for the next cron tick.
        </p>

        <div className="my-8 space-y-4">
          {MILESTONES.map(m => (
            <div
              key={m.title}
              className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-5"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                  {m.title}
                </h3>
                <Badge status={m.status} />
              </div>
              <p className="text-sm text-[var(--text-secondary)]">{m.body}</p>
            </div>
          ))}
        </div>

        <h2>Public API: what we\u2019re planning</h2>
        <p>
          When we launch the external API, the shape will be:
        </p>
        <ul>
          <li>
            <strong>Base URL</strong>: <code>https://api.padelgod.com/v1/</code> (subject to change).
          </li>
          <li>
            <strong>Auth</strong>: Bearer tokens scoped per workspace. Self-service rotation + rate-limit dashboard.
          </li>
          <li>
            <strong>Endpoints</strong>: tournaments, matches, sets/games, players, rankings, live feed (SSE or WebSocket), match-stats.
          </li>
          <li>
            <strong>Pagination</strong>: cursor-based (<code>?after=</code>, <code>?before=</code>), consistent across all list endpoints.
          </li>
          <li>
            <strong>Rate limits</strong>: per-token + per-IP, surfaced in response headers (<code>X-RateLimit-*</code>).
          </li>
          <li>
            <strong>Versioning</strong>: URL-prefixed versions (<code>/v1</code>, <code>/v2</code> when we break things). Deprecation notices in headers and docs.
          </li>
        </ul>

        <Callout variant="info" title="Interested in the public API?">
          Drop a line at <a href="mailto:hello@padelnachos.com">hello@padelnachos.com</a> with your use
          case. Early access is prioritized by who&apos;s building something useful on top.
        </Callout>

        <h2>Request something</h2>
        <p>
          Missing a tour? A data source? A column? Open a GitHub issue on the repo, or email us. We
          prioritize based on coverage impact and feasibility.
        </p>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/roadmap" />
    </article>
  )
}
