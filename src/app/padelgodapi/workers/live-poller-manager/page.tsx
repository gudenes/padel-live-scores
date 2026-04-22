// src/app/padelgodapi/workers/live-poller-manager/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'live-poller-manager' }

export default function LivePollerManagerPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="live-poller-manager"
        description="Lifecycle manager for in-process live-score pollers. Starts and stops one LivePollerLoop per active tournament, reconciling against two RPCs every minute."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>*/1 * * * *</code> — every minute. Registered in{' '}
          <code>padelgod/src/scheduler.ts</code>.
        </Callout>

        <h2>What it does</h2>
        <p>
          Each minute the manager asks the database which tournaments need a live poller right now.
          For every tournament in the answer it ensures a <code>LivePollerLoop</code> is running;
          for every loop whose tournament dropped out of the answer, it stops the loop. The loops
          themselves do the 3–6-second Crionet polling — the manager only handles
          start/stop/mode-transition.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            RPC <code>padelgod_tournaments_for_live_polling()</code> — tournaments where padelgod
            owns the live feed. Loops run in <code>canonical</code> mode.
          </li>
          <li>
            RPC <code>padelgod_tournaments_for_shadow_polling()</code> — tournaments where padelapi
            still owns the feed and we shadow-poll for parity. Loops run in <code>shadow</code>{' '}
            mode.
          </li>
        </ul>
        <p>
          Both RPCs return rows of <code>{'{ tournament_id, tournament_name, widget_id }'}</code>.
          They execute in parallel; if either fails the tick aborts without touching state.
        </p>

        <h2>Outputs</h2>
        <p>The manager itself doesn&apos;t write to tables. The loops it starts do:</p>
        <ul>
          <li>
            <strong>Canonical loops</strong> — write to <code>public.matches</code>,{' '}
            <code>public.sets</code>, <code>public.games</code> directly.
          </li>
          <li>
            <strong>Shadow loops</strong> — write to <code>padelgod.shadow_sets</code>,{' '}
            <code>padelgod.shadow_match_points</code>, and also dual-write into{' '}
            <code>public.*</code> via the shadow bridge.
          </li>
        </ul>

        <h2>Algorithm</h2>
        <ol>
          <li>Fetch both RPCs in parallel.</li>
          <li>
            Build a <code>desired</code> map of <code>tournament_id → {'{ widget_id, mode, name }'}</code>
            . Insert shadow rows first, then canonical rows — canonical wins on conflict.
          </li>
          <li>
            For each desired tournament: if no loop exists, start one. If a loop exists with the
            wrong mode (shadow→canonical cutover), stop it and start fresh. If a loop exists with
            the matching mode, no-op.
          </li>
          <li>
            For each existing loop whose tournament is NOT in the desired map, stop it and remove
            it.
          </li>
          <li>
            Return <code>{'{ active, started, stopped }'}</code>.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Module-scope state.</strong> The active-pollers map lives at module scope so it
            persists across ticks within the same Node process. A process restart means the next
            tick treats every active tournament as new (<code>started = N, stopped = 0</code>).
          </li>
          <li>
            <strong>Start failures don&apos;t register.</strong> If <code>loop.start()</code> throws,
            the tournament is logged and <em>not</em> added to the map — the next tick retries. This
            avoids zombie entries.
          </li>
          <li>
            <strong>Stop failures remove anyway.</strong> If <code>loop.stop()</code> throws, the
            loop is still removed from the map. Leaving a stale entry would permanently block a
            future restart.
          </li>
          <li>
            <strong>Conflict resolution.</strong> A tournament in both RPCs (should not happen given
            the RPC filters, but defensive) picks <code>canonical</code> mode.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Every tick logs at <code>info</code>: <code>started</code> and <code>stopped</code>{' '}
          counts, plus per-loop <code>tournamentId</code>, <code>widgetId</code>, and{' '}
          <code>mode</code>. Start failures log at <code>warn</code>.
        </p>
        <p>
          The <code>LivePollerLoop</code> instances the manager starts each write rows to{' '}
          <code>padelgod.scrape_jobs</code> per HTTP fetch (via the{' '}
          <code>runScrapeJob</code> wrapper inside the loop). Filter by{' '}
          <code>worker = &apos;live-poller-loop&apos;</code> to see recent per-tournament
          activity.
        </p>

        <h2>Debug recipes</h2>
        <p>Which tournaments should have a canonical poller right now?</p>
        <pre>
          <code>{`SELECT * FROM padelgod_tournaments_for_live_polling();`}</code>
        </pre>

        <p>Which tournaments should have a shadow poller right now?</p>
        <pre>
          <code>{`SELECT * FROM padelgod_tournaments_for_shadow_polling();`}</code>
        </pre>

        <p>Recent scrape activity for a specific tournament (written by the loop, not the manager):</p>
        <pre>
          <code>{`SELECT started_at, completed_at, status, worker
FROM padelgod.scrape_jobs
WHERE metadata->>'tournament_id' = '<your-tournament-uuid>'
ORDER BY started_at DESC
LIMIT 10;`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/live-poller-manager.ts</code>
          </li>
          <li>
            Loop: <code>padelgod/src/lib/live-poller-loop.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/live-poller-manager.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/live-poller-manager" />
    </article>
  )
}
