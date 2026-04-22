// src/app/padelgodapi/workers/page.tsx
// Reference table of every scheduled worker.

import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { PrevNextLinks } from '../_components/PrevNextLinks'
import { Callout } from '../_components/Callout'

export const metadata: Metadata = { title: 'Workers' }

const WORKERS: Array<{
  name: string
  cron: string
  cadence: string
  purpose: string
  reads: string
  writes: string
  /** When set, the worker's name cell links to a detail page. */
  detailHref?: string
}> = [
  {
    name: 'tournament-discovery',
    cron: '0 * * * *',
    cadence: 'Hourly at :00',
    purpose: 'Finds new tournaments on matchscorerlive/FIP listings and upserts stubs into public.tournaments.',
    reads: 'matchscorerlive listing, FIP WP JSON',
    writes: 'public.tournaments',
  },
  {
    name: 'widget-code-lookup',
    cron: '15 * * * *',
    cadence: 'Hourly at :15',
    purpose: 'Resolves the matchscorerlive widget code (FIP-YYYY-NNNN) for each tournament that needs one, using multiple strategies (search, iframe parse, page regex).',
    reads: 'public.tournaments, matchscorerlive',
    writes: 'padelgod.widget_id_cache',
  },
  {
    name: 'player-rankings',
    cron: '0 5 * * *',
    cadence: 'Daily 05:00 UTC',
    purpose: 'Syncs FIP official + race rankings (top 1,000 per gender) into public.players.',
    reads: 'FIP rankings endpoint',
    writes: 'public.players (ranking, points, ranking_date)',
  },
  {
    name: 'player-profile',
    cron: '30 * * * *',
    cadence: 'Hourly at :30',
    purpose: '(V1.5) Refreshes bio + avatar from FIP player profile pages for players the operator has flagged.',
    reads: 'padelfip.com/player/{slug}',
    writes: 'public.players (avatar_url, birthdate, hand, height, birthplace)',
  },
  {
    name: 'entry-list-fetcher',
    cron: '45 * * * *',
    cadence: 'Hourly at :45',
    purpose: 'Pulls entry lists (matchscorerlive widget) for active tournaments.',
    reads: 'matchscorerlive entry-list widget',
    writes: 'padelgod.entry_list_snapshots',
  },
  {
    name: 'draw-fetcher',
    cron: '20 */2 * * *',
    cadence: 'Every 2 hours at :20',
    purpose: 'Scrapes full draw (MD/WD/MQ/WQ, all rounds) for each active tournament.',
    reads: 'matchscorerlive /screen/draw',
    writes: 'padelgod.draw_snapshots',
  },
  {
    name: 'oop-fetcher',
    cron: '50 * * * *',
    cadence: 'Hourly at :50',
    purpose: 'Pulls the daily Order of Play (schedule, court assignments) for each active tournament.',
    reads: 'matchscorerlive /screen/oopbyday',
    writes: 'padelgod.oop_snapshots',
  },
  {
    name: 'results-fetcher',
    cron: '55 * * * *',
    cadence: 'Hourly at :55',
    purpose: 'Captures completed match results (final score, winner, retirement flag) per day.',
    reads: 'matchscorerlive /screen/resultsbyday',
    writes: 'padelgod.results_snapshots',
  },
  {
    name: 'static-reconciler',
    cron: '5,35 * * * *',
    cadence: 'Twice hourly at :05 and :35',
    purpose: 'Consumes entry_list / draw / OOP / results snapshots and materializes public.matches, public.sets, public.tournament_draws with resolved player UUIDs.',
    reads: 'padelgod.*_snapshots, public.players',
    writes: 'public.matches, public.sets, public.tournament_draws, public.players (upsert)',
    detailHref: '/padelgodapi/workers/static-reconciler',
  },
  {
    name: 'match-stats-fetcher',
    cron: '25 * * * *',
    cadence: 'Hourly at :25',
    purpose: 'Pulls per-set service/return/points stats from Premier Padel beforeauth API or padelapi /matches/{id}/stats.',
    reads: 'premierpadel.com, padelapi.org',
    writes: 'public.match_stats',
  },
  {
    name: 'live-poller-manager',
    cron: '*/1 * * * *',
    cadence: 'Every minute',
    purpose: 'Lifecycle manager for in-process live-score pollers. Starts one LivePollerLoop per shadow-enabled tournament with active matches; stops it when the tournament ends.',
    reads: 'public.tournaments',
    writes: 'padelgod.shadow_match_points, padelgod.shadow_sets',
    detailHref: '/padelgodapi/workers/live-poller-manager',
  },
  {
    name: 'shadow-diff-finalizer',
    cron: '10,40 * * * *',
    cadence: 'Twice hourly at :10 and :40',
    purpose: 'After reconciliation settles, diffs shadow state against canonical state for finished matches. Records divergences.',
    reads: 'padelgod.shadow_*, public.matches, public.sets',
    writes: 'padelgod.shadow_diff (final_state)',
  },
  {
    name: 'shadow-diff-live',
    cron: '*/1 * * * *',
    cadence: 'Every minute',
    purpose: 'Per-live-match latency snapshot — measures how fresh the shadow pipeline is vs. canonical.',
    reads: 'padelgod.shadow_sets, public.sets',
    writes: 'padelgod.shadow_diff (live_latency)',
    detailHref: '/padelgodapi/workers/shadow-diff-live',
  },
]

export default function WorkersPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Reference"
        title="Workers"
        description="Every scheduled job in padelgod, what it does, when it runs, and which tables it touches."
      />
      <Prose>
        <h2>At a glance</h2>
        <p>
          Thirteen workers run on a Node-cron scheduler inside the padelgod Railway service. Each can
          also be triggered on-demand via <code>POST /admin/run-worker</code> with a bearer token.
        </p>

        <div className="my-6 overflow-x-auto rounded-lg border border-[var(--border-base)]">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Worker
                </th>
                <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Cadence
                </th>
                <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Purpose
                </th>
                <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Writes to
                </th>
              </tr>
            </thead>
            <tbody>
              {WORKERS.map(w => (
                <tr key={w.name} className="hover:bg-[var(--bg-subtle)]">
                  <td className="border-b border-[var(--border-base)] px-3 py-3 align-top">
                    {w.detailHref ? (
                      <Link
                        href={w.detailHref}
                        className="font-mono text-xs font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        {w.name}
                      </Link>
                    ) : (
                      <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                        {w.name}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                      {w.cron}
                    </div>
                  </td>
                  <td className="border-b border-[var(--border-base)] px-3 py-3 align-top text-xs text-[var(--text-secondary)]">
                    {w.cadence}
                  </td>
                  <td className="border-b border-[var(--border-base)] px-3 py-3 align-top text-sm text-[var(--text-secondary)]">
                    {w.purpose}
                  </td>
                  <td className="border-b border-[var(--border-base)] px-3 py-3 align-top font-mono text-xs text-[var(--text-primary)]">
                    {w.writes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Triggering workers on demand</h2>
        <p>
          In addition to cron, every worker can be kicked off manually via padelgod&apos;s admin
          endpoint:
        </p>
        <pre>
          <code>{`curl -X POST $PADELGOD_URL/admin/run-worker \\
  -H "Authorization: Bearer $PADELGOD_ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"worker":"draw-fetcher"}'`}</code>
        </pre>
        <p>
          Useful when onboarding a new tournament (no need to wait for the 2-hour draw-fetcher cron)
          or after shipping a parser fix (re-scrape immediately to validate).
        </p>

        <Callout variant="note" title="Per-tournament scoping">
          Today, every worker runs against <strong>all</strong> active tournaments returned by the{' '}
          <code>padelgod_active_tournaments_for_static_workers</code> RPC. Tournament-scoped
          invocation is a V2 feature; the roadmap has more.
        </Callout>

        <h2>Observability</h2>
        <p>
          Every worker run creates a row in <code>padelgod.scrape_jobs</code> with:
        </p>
        <ul>
          <li>The worker name + target URL</li>
          <li>Start / completion timestamps + duration</li>
          <li>Status: queued, running, success, failed</li>
          <li>Error message on failure</li>
          <li>Parser version (so we can diff behavior after parser updates)</li>
        </ul>
        <p>
          <code>scrape_jobs</code> is the first stop when debugging a missing piece of data — filter
          by <code>tournament_id</code> and see every scrape we&apos;ve attempted.
        </p>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers" />
    </article>
  )
}
