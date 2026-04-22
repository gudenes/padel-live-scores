// src/app/padelgodapi/architecture/page.tsx
// The three-layer data-flow model + shadow mode.

import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { Callout } from '../_components/Callout'
import { PrevNextLinks } from '../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Architecture' }

function FlowDiagram() {
  return (
    <div className="my-8 rounded-lg border border-[var(--border-base)] bg-[var(--bg-card-alt)] p-6">
      <div className="flex flex-col items-stretch gap-4 text-sm md:flex-row md:items-start md:justify-between">
        {/* Column 1: Sources */}
        <div className="flex-1">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Sources
          </p>
          <div className="space-y-2">
            {[
              'matchscorerlive.com',
              'padelfip.com',
              'padelapi.org',
              'premierpadel.com',
              'FIP rankings',
            ].map(s => (
              <div
                key={s}
                className="rounded border border-[var(--border-base)] bg-[var(--bg-card)] p-2 text-center font-mono text-xs text-[var(--text-primary)]"
              >
                {s}
              </div>
            ))}
          </div>
        </div>

        <div className="hidden self-center text-[var(--text-muted)] md:block">→</div>

        {/* Column 2: Snapshots */}
        <div className="flex-1">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Snapshots (append-only)
          </p>
          <div className="space-y-2">
            {[
              'entry_list_snapshots',
              'draw_snapshots',
              'oop_snapshots',
              'results_snapshots',
              'shadow_match_points',
            ].map(s => (
              <div
                key={s}
                className="rounded border border-[var(--border-base)] bg-[var(--bg-card)] p-2 text-center font-mono text-xs text-[var(--text-primary)]"
              >
                padelgod.{s}
              </div>
            ))}
          </div>
        </div>

        <div className="hidden self-center text-[var(--text-muted)] md:block">→</div>

        {/* Column 3: Canonical */}
        <div className="flex-1">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Canonical (served by UI)
          </p>
          <div className="space-y-2">
            {[
              'tournaments',
              'matches',
              'sets',
              'games',
              'players',
              'tournament_draws',
            ].map(s => (
              <div
                key={s}
                className="rounded border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-2 text-center font-mono text-xs text-[var(--text-primary)]"
              >
                public.{s}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
        Reconcilers sit between columns 2 and 3; consumers read only column 3.
      </p>
    </div>
  )
}

export default function ArchitecturePage() {
  return (
    <article>
      <PageHeader
        eyebrow="How it works"
        title="Architecture"
        description="PadelGod is a three-layer pipeline — raw sources, append-only snapshots, canonical tables. This shape is deliberate: it makes the system self-healing, auditable, and safe to iterate on."
      />
      <Prose>
        <h2>The three layers</h2>
        <FlowDiagram />

        <h3>Layer 1 — Sources</h3>
        <p>
          Every piece of data originates from an external source. Some are HTTP APIs, some are HTML
          scraping, some are PDF extraction. Each source has its own quirks: rate limits, auth,
          refresh cadence, schema changes.
        </p>
        <p>
          Scrapers (workers) talk to sources. They don&apos;t write to canonical tables directly —
          their sole job is to <strong>capture</strong> what the source currently says.
        </p>

        <h3>Layer 2 — Snapshots</h3>
        <p>
          Every successful scrape lands as rows in an append-only <code>padelgod.*_snapshots</code>{' '}
          table. A row records: the source it came from, the scrape job that produced it, the timestamp,
          and a structured copy of the parsed payload.
        </p>
        <p>
          Because snapshots are append-only, every state the system has ever observed is preserved.
          You can replay a tournament&apos;s day-by-day story by walking the snapshot history. A buggy
          parser release can be diagnosed by diff-ing its snapshots against the previous version&apos;s.
        </p>
        <Callout variant="info" title="Why snapshots?">
          Overwriting canonical rows with every scrape would mean any bug — a misread HTML attribute,
          a truncated PDF extraction — could silently corrupt data we&apos;d already served to users.
          The snapshot layer isolates that risk: bad scrapes just produce bad snapshots. The canonical
          layer only reflects the reconciler&apos;s considered view.
        </Callout>

        <h3>Layer 3 — Canonical</h3>
        <p>
          Reconcilers read snapshots (and cross-reference them with other sources when applicable)
          and materialize <code>public.*</code> rows. This is what the padelnachos app queries, and
          what the future public API will expose.
        </p>
        <p>
          Reconcilers enforce source priority: when Premier Padel and FIP both claim a player&apos;s
          ranking, the reconciler picks the authoritative source per field. See{' '}
          <a href="/padelgodapi/data-model">Data model</a> for the field-level priority rules.
        </p>

        <h2>Workers run on cron</h2>
        <p>
          PadelGod is a long-running Node service (Railway). A lightweight scheduler (
          <code>node-cron</code>) kicks off each worker on its own cadence:
        </p>
        <ul>
          <li>High-frequency: <code>live-poller-manager</code> runs every minute</li>
          <li>Hourly: entry list, OOP, results, match stats, widget-code-lookup</li>
          <li>Every 2 hours: draws</li>
          <li>Twice hourly: static reconciler (at :05 and :35)</li>
          <li>Daily: FIP rankings (05:00 UTC)</li>
        </ul>
        <p>
          See the <a href="/padelgodapi/workers">workers reference</a> for per-worker detail.
        </p>

        <h2>Shadow mode</h2>
        <p>
          When we onboard a new source or change an existing parser, we&apos;d like to verify it
          against the current production data before cutting over. Shadow mode is the mechanism.
        </p>
        <p>
          A tournament can be flipped to <code>shadow_enabled=true</code>. From that moment on, the
          new pipeline writes to parallel <code>padelgod.shadow_*</code> tables instead of the
          canonical ones. An ops dashboard surfaces divergences — cases where the shadow pipeline
          produced different set scores, points, or winners than the current production pipeline.
        </p>
        <p>
          Once divergence metrics look clean for a few tournaments, we &quot;cut over&quot;: flip
          the tournament&apos;s <code>live_source</code> so the new pipeline starts writing to
          canonical tables and the old one stops. No user-visible downtime.
        </p>

        <h2>Design principles</h2>
        <ul>
          <li>
            <strong>Capture before interpret.</strong> Snapshots first, reconciliation second. Every
            bad reconciliation can be re-run from history.
          </li>
          <li>
            <strong>Source lineage everywhere.</strong> Canonical rows record which source each field
            came from so trust decisions can be made downstream.
          </li>
          <li>
            <strong>Idempotent writes.</strong> Every scrape, every reconcile, every upsert is safe
            to re-run. No hidden side effects that break on retry.
          </li>
          <li>
            <strong>Shadow &gt; big bang.</strong> Every risky change runs behind a feature flag before
            it touches canonical data.
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/architecture" />
    </article>
  )
}
