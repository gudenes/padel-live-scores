// src/app/padelgodapi/workers/shadow-diff-live/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'shadow-diff-live' }

export default function ShadowDiffLivePage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="shadow-diff-live"
        description="Per-minute latency snapshot for live matches — measures how fresh the padelgod shadow pipeline is vs. the canonical (padelapi) path."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>*/1 * * * *</code> — every minute. Registered in{' '}
          <code>padelgod/src/scheduler.ts</code>.
        </Callout>

        <h2>What it does</h2>
        <p>
          For every live (or recently ended) match inside a shadow-enrolled tournament, compares the
          highest-numbered set&apos;s <code>updated_at</code> on <code>public.sets</code> (the
          relay-written canonical path) vs <code>padelgod.shadow_sets</code> (the padelgod shadow
          path). Writes one row per match per tick to <code>padelgod.shadow_diff</code>.
        </p>
        <p>
          This is the signal the team watches when answering &quot;is the shadow path keeping up
          with production?&quot;. Positive <code>latency_delta_ms</code> means padelgod is slower
          than the canonical path; negative means ahead.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            <code>public.tournaments</code> — rows where <code>shadow_enabled = true</code>.
          </li>
          <li>
            <code>public.matches</code> — rows with <code>status IN (&apos;live&apos;, &apos;ended&apos;)</code>{' '}
            and <code>tournament_id</code> in the shadow-enabled list.
          </li>
          <li>
            <code>public.sets</code> — the current set row for each candidate match (highest{' '}
            <code>set_number</code>, most recent <code>updated_at</code>).
          </li>
          <li>
            <code>padelgod.shadow_sets</code> — the shadow path&apos;s equivalent row for the same
            (match, set_number).
          </li>
        </ul>

        <h2>Outputs</h2>
        <ul>
          <li>
            <code>padelgod.shadow_diff</code> — one row per (match, tick) with{' '}
            <code>comparison_type = &apos;live_latency&apos;</code>,{' '}
            <code>padelapi_updated_at</code>, <code>padelgod_updated_at</code>, and{' '}
            <code>latency_delta_ms = padelgod_updated_at - padelapi_updated_at</code> (ms).
          </li>
        </ul>
        <p>
          There is no uniqueness constraint on <code>live_latency</code> rows — they accumulate
          over time so you can chart the latency trend per match.
        </p>

        <h2>Algorithm</h2>
        <ol>
          <li>
            Read shadow-enrolled tournament IDs. If the list is empty, return early with{' '}
            <code>{'{ rowsWritten: 0, matchesConsidered: 0 }'}</code>.
          </li>
          <li>
            Read candidate matches: <code>status IN (&apos;live&apos;, &apos;ended&apos;)</code>{' '}
            scoped to those tournaments.
          </li>
          <li>
            For each match, fetch the highest-numbered set from <code>public.sets</code> and from{' '}
            <code>padelgod.shadow_sets</code>.
          </li>
          <li>
            If either side has no row, skip the match silently. Otherwise, compute{' '}
            <code>latency_delta_ms = padelgod_ms - padelapi_ms</code> and insert one row into{' '}
            <code>padelgod.shadow_diff</code>.
          </li>
          <li>
            Return <code>{'{ rowsWritten, matchesConsidered }'}</code>.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Per-match isolation.</strong> A thrown error on one match is logged at{' '}
            <code>warn</code> and the loop continues with the next match.
          </li>
          <li>
            <strong>No uniqueness.</strong> Rows accumulate — this is a time-series, not a
            snapshot.
          </li>
          <li>
            <strong>Finished matches.</strong> Only <code>live</code> and <code>ended</code>{' '}
            statuses are considered; <code>finished</code> is handled by{' '}
            <code>shadow-diff-finalizer</code>.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Each tick logs <code>rowsWritten</code> and <code>matchesConsidered</code> at{' '}
          <code>info</code> via pino. Per-match failures log at <code>warn</code> with{' '}
          <code>matchId</code> and error message.
        </p>
        <p>
          Note: this worker does not write to <code>padelgod.scrape_jobs</code> — the scheduler
          wrapper only logs via pino. To confirm the worker is running, query{' '}
          <code>padelgod.shadow_diff</code> for recent <code>recorded_at</code> values (see debug
          recipes below).
        </p>

        <h2>Debug recipes</h2>
        <p>Latest latency per live match, sorted worst first:</p>
        <pre>
          <code>{`SELECT
  m.id AS match_id,
  t.name AS tournament,
  sd.latency_delta_ms,
  sd.recorded_at
FROM padelgod.shadow_diff sd
JOIN public.matches m ON m.id = sd.match_id
JOIN public.tournaments t ON t.id = m.tournament_id
WHERE sd.comparison_type = 'live_latency'
  AND sd.recorded_at > now() - interval '10 minutes'
ORDER BY sd.latency_delta_ms DESC NULLS LAST
LIMIT 20;`}</code>
        </pre>

        <p>Is the worker actually running? (No scrape_jobs rows — check the diff table instead):</p>
        <pre>
          <code>{`SELECT
  max(recorded_at)                    AS last_tick,
  now() - max(recorded_at)            AS age,
  count(*) FILTER (WHERE recorded_at > now() - interval '5 minutes') AS rows_last_5m
FROM padelgod.shadow_diff
WHERE comparison_type = 'live_latency';`}</code>
        </pre>

        <p>Rolling 1-hour P50/P95 latency:</p>
        <pre>
          <code>{`SELECT
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_delta_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_delta_ms) AS p95_ms,
  count(*) AS samples
FROM padelgod.shadow_diff
WHERE comparison_type = 'live_latency'
  AND recorded_at > now() - interval '1 hour';`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/shadow-diff-live.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/shadow-diff-live.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/shadow-diff-live" />
    </article>
  )
}
