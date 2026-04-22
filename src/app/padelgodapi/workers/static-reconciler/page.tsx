// src/app/padelgodapi/workers/static-reconciler/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'static-reconciler' }

export default function StaticReconcilerPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="static-reconciler"
        description="Consumes entry-list, draw, OOP, and results snapshots and materializes them into public.players, public.matches, public.sets, and public.tournament_draws."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>5,35 * * * *</code> — twice hourly at :05 and :35. Deliberately staggered five
          minutes after the fetchers so fresh snapshots land first.
        </Callout>

        <h2>What it does</h2>
        <p>
          The reconciler is the bridge between raw snapshot tables and the canonical{' '}
          <code>public.*</code> schema the rest of the app reads. Fetchers drop immutable snapshots
          into <code>padelgod.*_snapshots</code>; the reconciler picks them up, resolves player and
          match identities, and writes normalized rows that application queries hit.
        </p>
        <p>
          This is also the worker that heals <code>status</code> and <code>winner_pair</code> on
          finished matches end-to-end — padelgod owns those fields today via the results phase.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            <code>padelgod.entry_list_snapshots</code> — entry-list rows from the last 14 days.
          </li>
          <li>
            <code>padelgod.draw_snapshots</code> — draw rows (MD/WD/MQ/WQ).
          </li>
          <li>
            <code>padelgod.oop_snapshots</code> — per-day Order of Play (court, round label).
          </li>
          <li>
            <code>padelgod.results_snapshots</code> — completed-match results (set scores, winner,
            status).
          </li>
          <li>
            <code>padelgod.widget_id_cache</code> — active widget ID per tournament, required by
            the OOP and results phases to call <code>findOrCreateMatch</code>.
          </li>
          <li>
            <code>public.players</code> — existing player rows, used to resolve short names and
            deduplicate upserts.
          </li>
        </ul>

        <h2>Outputs</h2>
        <ul>
          <li>
            <code>public.players</code> — upserts by <code>fip_id</code>. Writes{' '}
            <code>name</code>, <code>country</code>, <code>category</code>, and{' '}
            <code>last_updated_by = &apos;padelgod&apos;</code>.
          </li>
          <li>
            <code>public.matches</code> — upserts via <code>findOrCreateMatch</code>. The draw
            phase writes a thin row keyed on a synthetic widget id; the OOP phase writes{' '}
            <code>court</code> and <code>round</code>; the results phase writes{' '}
            <code>status</code> and <code>winner_pair</code>.
          </li>
          <li>
            <code>public.sets</code> — upserts set scores from results snapshots with{' '}
            <code>score_source = &apos;api&apos;</code>.
          </li>
          <li>
            <code>public.tournament_draws</code> — two bracket rows per draw snapshot match (one
            per team/pair), keyed on <code>(tournament_id, category, draw_position)</code>.
          </li>
          <li>
            <code>padelgod.unresolved_players</code> — one row per short name the draw phase
            couldn&apos;t resolve to a <code>fip_id</code>. Cleared automatically when the
            underlying entry-list data becomes available.
          </li>
        </ul>

        <h2>Algorithm</h2>
        <ol>
          <li>
            <strong>Phase 1 — entry-list.</strong> Read <code>padelgod.entry_list_snapshots</code>{' '}
            from the last 14 days. Group by <code>(tournament_id, category)</code>, keep only the
            latest <code>captured_at</code> batch per group, then upsert a{' '}
            <code>public.players</code> row for each unique <code>fip_id</code>. Rows with a null{' '}
            <code>fip_id</code> or null <code>name</code> are skipped. Tracks{' '}
            <code>playersUpserted</code> and <code>playersSkipped</code>.
          </li>
          <li>
            <strong>Phase 2 — draw.</strong> For each draw snapshot, build a tournament dictionary
            from the latest entry-list snapshot (including <code>partner_fip_id</code> for
            pair-based disambiguation). Resolve the four short names on each draw row via{' '}
            <code>resolveShortName</code>. If all four resolve, call{' '}
            <code>findOrCreateMatch</code> with a synthetic widget id{' '}
            (<code>category:draw_type:round_label:draw_position</code>) and write two rows to{' '}
            <code>public.tournament_draws</code> — one per team. Unresolved names are queued in{' '}
            <code>padelgod.unresolved_players</code> and the draw row is skipped entirely. Tracks{' '}
            <code>drawMatchesWritten</code>, <code>drawTeamsWritten</code>, and{' '}
            <code>drawsUnresolved</code>.
          </li>
          <li>
            <strong>Phase 3 — OOP.</strong> For each <code>oop_snapshots</code> row with a
            non-null <code>match_widget_id</code>, look up the tournament&apos;s active widget ID
            from <code>padelgod.widget_id_cache</code>. If missing, skip (retried next tick). Resolve
            the four short names, call <code>findOrCreateMatch</code>, then update the match&apos;s{' '}
            <code>court</code> and <code>round</code>. Note: <code>scheduled_at</code> is
            intentionally not written — timezone-aware time parsing is handled by the main
            app&apos;s OOP review workflow. Tracks <code>oopMatchesUpdated</code> and{' '}
            <code>oopUnresolved</code>.
          </li>
          <li>
            <strong>Phase 4 — results.</strong> For each <code>results_snapshots</code> row with a
            non-null <code>match_widget_id</code>, look up the active widget ID, resolve the four
            short names, call <code>findOrCreateMatch</code>, then update the match&apos;s{' '}
            <code>status</code> and <code>winner_pair</code>. Parse the <code>set_scores</code>{' '}
            string and upsert each set into <code>public.sets</code> with{' '}
            <code>score_source = &apos;api&apos;</code>. Tracks{' '}
            <code>resultsMatchesUpdated</code>, <code>setsWritten</code>, and{' '}
            <code>resultsUnresolved</code>.
          </li>
          <li>
            Return per-phase counters.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Independent phases.</strong> A failure in phase 3 does not roll back phases 1
            or 2. Each phase commits incrementally; errors throw and the scheduler wrapper logs
            them.
          </li>
          <li>
            <strong>Unresolved queue is idempotent.</strong> Re-running the reconciler re-upserts
            the same <code>unresolved_players</code> rows via <code>onConflict + ignoreDuplicates</code>.
            Once the underlying entry-list data is available, the next tick resolves the name and
            writes the draw row.
          </li>
          <li>
            <strong>No scheduled_at writes from OOP.</strong> The OOP phase deliberately skips
            writing <code>scheduled_at</code> — widget time labels (&quot;Starting at 10:00 AM&quot;,
            &quot;Followed by&quot;) require tournament-timezone handling that belongs to the main
            app&apos;s human-in-the-loop schedule review workflow.
          </li>
          <li>
            <strong>Draw phase writes synthetic widget IDs.</strong> The synthetic ID (
            <code>category:draw_type:round_label:draw_position</code>) is stable across runs. When
            OOP/results later provide a real widget ID, <code>findOrCreateMatch</code>&apos;s
            pair-based fallback links the existing record.
          </li>
          <li>
            <strong>14-day lookback.</strong> Snapshots older than 14 days are ignored. Tournaments
            that finished before that window are not re-reconciled.
          </li>
          <li>
            <strong>OOP and results require a cached widget ID.</strong> If{' '}
            <code>padelgod.widget_id_cache</code> has no active row for a tournament, those phases
            skip all rows for that tournament and count them as unresolved. Resolution happens
            automatically on the next tick once the widget-code-lookup worker populates the cache.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Each tick returns and logs a rich counter object: <code>tournamentsProcessed</code>,{' '}
          <code>playersUpserted</code>, <code>playersSkipped</code>,{' '}
          <code>drawMatchesWritten</code>, <code>drawTeamsWritten</code>,{' '}
          <code>drawsUnresolved</code>, <code>oopMatchesUpdated</code>,{' '}
          <code>oopUnresolved</code>, <code>resultsMatchesUpdated</code>,{' '}
          <code>setsWritten</code>, <code>resultsUnresolved</code>.
        </p>
        <p>
          Note: this worker does not write to <code>padelgod.scrape_jobs</code> — the scheduler
          wrapper only logs via pino. To confirm the worker is running, query recently updated{' '}
          <code>public.matches</code> or <code>public.players</code> rows for{' '}
          <code>last_updated_by = &apos;padelgod&apos;</code> (see debug recipes below).
        </p>

        <h2>Debug recipes</h2>
        <p>Is the reconciler writing? Check recently touched matches:</p>
        <pre>
          <code>{`-- Replace <tournament_id> with the UUID you care about.
SELECT id, status, winner_pair, court, round, updated_at
FROM public.matches
WHERE tournament_id = '<tournament_id>'
  AND last_updated_by = 'padelgod'
ORDER BY updated_at DESC
LIMIT 10;`}</code>
        </pre>

        <p>Unresolved draw names, newest first:</p>
        <pre>
          <code>{`SELECT
  tournament_id,
  widget_short_name,
  partner_short_name,
  status,
  created_at
FROM padelgod.unresolved_players
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 20;`}</code>
        </pre>

        <p>Why did a specific match not pick up set scores?</p>
        <pre>
          <code>{`-- Replace <widget_match_id> with the real one.
SELECT
  rs.team1_player1_name || ' / ' || rs.team1_player2_name AS team1,
  rs.team2_player1_name || ' / ' || rs.team2_player2_name AS team2,
  rs.set_scores,
  rs.status,
  rs.captured_at
FROM padelgod.results_snapshots rs
WHERE rs.match_widget_id = '<widget_match_id>'
ORDER BY rs.captured_at DESC
LIMIT 3;`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/static-reconciler.ts</code>
          </li>
          <li>
            Player resolution: <code>padelgod/src/lib/tournament-dictionary.ts</code>
          </li>
          <li>
            Match resolution: <code>padelgod/src/lib/match-identifier.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/static-reconciler.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/static-reconciler" />
    </article>
  )
}
