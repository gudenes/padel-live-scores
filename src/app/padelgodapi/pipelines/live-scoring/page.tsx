// src/app/padelgodapi/pipelines/live-scoring/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Live scoring pipeline' }

export default function LiveScoringPipelinePage() {
  return (
    <article>
      <PageHeader
        eyebrow="Pipelines"
        title="Live scoring"
        description="How a live match flows through padelgod — from Crionet polling to public.matches, plus the parity-validation loop that runs alongside it and the close-out path that lands the final state."
      />
      <Prose>
        <h2>What this chain produces</h2>
        <p>
          A live match with accurate per-set scores, <code>finished_at</code>, a resolved winner,
          and player FKs in <code>public.matches</code> / <code>public.sets</code> within
          roughly a minute of the real-world finish. Alongside, a time-series of{' '}
          <code>latency_delta_ms</code> rows in <code>padelgod.shadow_diff</code> so dashboards
          can quantify how fresh the shadow path is compared to the canonical relay.
        </p>

        <h2>Flow</h2>
        <pre>
          <code>{`     scheduler (every minute)
            │
            ▼
   ┌──────────────────────┐      two RPCs
   │ live-poller-manager  │──────┐
   └──────────┬───────────┘      ▼
              │   padelgod_tournaments_for_live_polling()
              │   padelgod_tournaments_for_shadow_polling()
              ▼
   per-tournament  LivePollerLoop  (3–6s Crionet polling)
              │
       ┌──────┴──────────────────────┐
       │                             │
   shadow mode                 canonical mode
       │                             │
       ▼                             ▼
 padelgod.shadow_sets         public.sets / public.games
 padelgod.shadow_match_points public.matches
       │                             │
       │ dual-write bridge           │ (direct)
       └──────────────┬──────────────┘
                      │
                      ▼
            public.sets / public.matches
                      │
                      ▼
   ┌───────────────────────────────┐
   │ shadow-diff-live (every min)  │─→ padelgod.shadow_diff (live_latency)
   └───────────────────────────────┘

  ───── match finishes (widget tick OR disappeared) ─────

                      │
                      ▼
   ┌─────────────────────────────────────┐
   │ LivePollerLoop.closeMatch           │
   │   writes status='finished',         │
   │   winner_pair, finished_at, sets    │
   └─────────────────────────────────────┘
                      │
                      ▼  (fallback safety net)
   ┌───────────────────────────────┐
   │ static-reconciler (:05, :35)  │─→ score correction from resultsbyday
   │ results phase                 │   (overwrites set scores only)
   └───────────────────────────────┘`}</code>
        </pre>

        <h2>Step-by-step walkthrough</h2>

        <h3>1. live-poller-manager starts a loop</h3>
        <p>
          Every minute the manager asks two RPCs which tournaments need a poller. Each
          qualifying tournament gets a <code>LivePollerLoop</code> — shadow or canonical mode
          depending on which RPC it came from. Canonical wins if a tournament shows up in both.
        </p>
        <p>
          <strong>State after this step:</strong> one <code>LivePollerLoop</code> per active
          tournament in the process-level <code>activePollers</code> map. Nothing in the DB yet.
        </p>
        <p>
          Detail:{' '}
          <Link href="/padelgodapi/workers/live-poller-manager">live-poller-manager</Link>.
        </p>

        <h3>2. Each loop polls Crionet and writes</h3>
        <p>
          The loop hits Crionet every 3–6 seconds (adaptive — slower when nothing is changing,
          faster during a rally). On each poll it calls{' '}
          <code>findOrCreateMatch</code> to resolve a canonical{' '}
          <code>public.matches</code> row, then diffs the new payload against the last known
          state and writes deltas.
        </p>

        <Callout variant="note" title="findOrCreateMatch's four-tier lookup">
          <ol>
            <li>
              <strong>Widget-id</strong> lookup via <code>entity_external_ids</code> (source{' '}
              <code>crionet_widget</code>) — fastest path when we&apos;ve seen this match
              before.
            </li>
            <li>
              <strong>Padelapi-twin</strong> fallback — look for a pre-existing row with{' '}
              <code>padelapi_id IS NOT NULL</code> on the same{' '}
              <code>(tournament, category, round, LOWER(court))</code>. When found, link our
              widget id to it instead of inserting a duplicate. Critical for Premier
              tournaments where our entry-list widget returns &quot;coming soon&quot;.
            </li>
            <li>
              <strong>Pair-based</strong> fallback — match on unordered player UUIDs within{' '}
              <code>(tournament, category, round)</code>. Only runs when caller passes player
              ids (reconciler path, not live-poller).
            </li>
            <li>
              <strong>Fresh INSERT</strong> — last resort. Creates a thin row with null player
              FKs. Used only when the first three lookups miss.
            </li>
          </ol>
        </Callout>

        <ul>
          <li>
            <strong>Canonical mode</strong> writes to <code>public.matches</code>,{' '}
            <code>public.sets</code>, <code>public.games</code> directly.
          </li>
          <li>
            <strong>Shadow mode</strong> writes to <code>padelgod.shadow_sets</code>,{' '}
            <code>padelgod.shadow_match_points</code>, and also dual-writes into{' '}
            <code>public.*</code> via the shadow bridge so the match is visible on padelnachos.
          </li>
        </ul>
        <p>
          <strong>State after this step:</strong> <code>public.sets</code> rows update in ~real
          time.
        </p>

        <h3>3. shadow-diff-live records the freshness delta</h3>
        <p>
          Every minute the diff worker reads both <code>public.sets</code> and{' '}
          <code>padelgod.shadow_sets</code> for each live match in a shadow-enrolled
          tournament, and writes{' '}
          <code>shadow_updated_at - canonical_updated_at</code> (ms) into{' '}
          <code>padelgod.shadow_diff</code>. Positive = padelgod slower, negative = padelgod
          ahead.
        </p>
        <p>
          <strong>State after this step:</strong> a row per live match in the{' '}
          <code>live_latency</code> time-series, used by dashboards to quantify parity.
        </p>
        <p>
          Detail: <Link href="/padelgodapi/workers/shadow-diff-live">shadow-diff-live</Link>.
        </p>

        <h3>4. Match finishes — live-poller closes atomically</h3>
        <p>
          Closing a match is owned by the live-poller itself, not by the reconciler. Two
          triggers call <code>closeMatch</code>:
        </p>
        <ul>
          <li>
            <strong>Case A — widget emits a terminal tick.</strong> On the tick where{' '}
            <code>curr.status === &apos;finished&apos;</code> on the widget (live→finished
            edge), live-poller infers the winner from sets and writes status,{' '}
            <code>winner_pair</code>, <code>finished_at</code>, <code>duration</code>, and
            final set rows in one atomic flow.
          </li>
          <li>
            <strong>Case B — match disappears from the feed.</strong> Crionet sometimes drops
            a finished match from the tournamentlive response without emitting a terminal
            tick. At the end of each tick, live-poller compares <code>this.states</code>{' '}
            against the new parsed list — any tracked matchId that&apos;s gone gets closed
            with the last-known state.
          </li>
          <li>
            <strong>Trailing-set extrapolation.</strong> When the last observed set was
            mid-play (e.g., 5-0 for the winner), <code>buildFinalSets</code> bumps the
            winner&apos;s games to 6 (or 7 at 6-5 / 6-6 for tiebreak scenarios). This repairs
            the &quot;one game missing&quot; artifact that shows up when Crionet moves faster
            than our polling cadence.
          </li>
        </ul>
        <p>
          <strong>State after this step:</strong> <code>public.matches</code> row has{' '}
          <code>status=&apos;finished&apos;</code>, <code>winner_pair</code>,{' '}
          <code>finished_at</code>, and the set rows reflect the real final. All{' '}
          <code>is_current</code> flags are cleared.
        </p>
        <p>
          Detail:{' '}
          <Link href="/padelgodapi/workers/static-reconciler">static-reconciler</Link>{' '}
          (runs phase 4 as a safety net against Case A/B misses).
        </p>

        <Callout variant="note" title="Close-match guards">
          <ul>
            <li>
              <code>.eq(&apos;status&apos;, &apos;live&apos;)</code> — never regress a row
              already in a terminal state (<code>finished</code> /<code>retired</code> /{' '}
              <code>walkover</code>).
            </li>
            <li>
              <strong>Canonical mode only.</strong> Shadow runs never mutate canonical status.
            </li>
            <li>
              <strong>Indecisive state</strong> (neither pair has 2 set wins) — logs{' '}
              <code>warn</code> and skips instead of guessing. Reconciler or manual patch
              handles those.
            </li>
            <li>
              <strong>Idempotent</strong> — re-running on an already-closed row is a no-op
              thanks to the status guard.
            </li>
          </ul>
        </Callout>

        <h2>Failure modes</h2>

        <Callout
          variant="warning"
          title="Symptom: live match score isn&apos;t updating"
        >
          <p>
            <strong>Likely cause:</strong> the <code>LivePollerLoop</code> for the tournament
            stopped or never started.
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              <code>SELECT * FROM padelgod_tournaments_for_live_polling();</code> — is the
              tournament listed?
            </li>
            <li>
              <code>SELECT * FROM padelgod_tournaments_for_shadow_polling();</code> — same
              check.
            </li>
            <li>
              <code>padelgod.scrape_jobs</code> filtered by{' '}
              <code>job_type = &apos;tournamentlive&apos;</code> — did recent ticks run?
            </li>
          </ol>
          <p>
            <strong>Recovery:</strong> if the RPC returns no row, the tournament isn&apos;t
            eligible — check <code>widget_id</code>, <code>live_source</code>, and{' '}
            <code>shadow_enabled</code> on <code>public.tournaments</code>. Persistent start
            failures log at <code>warn</code> with the error reason.
          </p>
        </Callout>

        <Callout
          variant="warning"
          title="Symptom: shadow_diff latency is climbing"
        >
          <p>
            <strong>Likely cause:</strong> either the relay path is slow (canonical stale →
            negative delta, padelgod ahead) or the <code>LivePollerLoop</code> is stuck
            (positive delta, padelgod behind).
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              Compare <code>public.sets.updated_at</code> to <code>now()</code> for a live
              match.
            </li>
            <li>
              Compare <code>padelgod.shadow_sets.updated_at</code> to <code>now()</code>.
            </li>
          </ol>
        </Callout>

        <Callout
          variant="warning"
          title="Symptom: match finished IRL but status is still 'live' or 'ended'"
        >
          <p>
            <strong>Likely cause:</strong> closeMatch didn&apos;t fire (Crionet emitted no
            terminal tick AND the match didn&apos;t disappear from the feed), OR status is{' '}
            <code>&apos;ended&apos;</code> — that&apos;s padelapi&apos;s transient state,
            not padelgod&apos;s.
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              <code>SELECT status, padelapi_id, updated_at FROM matches WHERE id = &apos;…&apos;</code>{' '}
              — if <code>padelapi_id</code> is set, status <code>&apos;ended&apos;</code> is
              padelapi&apos;s responsibility. Either wait for padelapi&apos;s next update or
              transition manually via SQL.
            </li>
            <li>
              <code>SELECT * FROM padelgod.results_snapshots WHERE widget_match_id = &apos;…&apos;</code>{' '}
              — is results-fetcher catching the completed match?
            </li>
          </ol>
        </Callout>

        <Callout
          variant="warning"
          title="Symptom: finished match shows 'TBD' for player names"
        >
          <p>
            <strong>Likely cause:</strong> the match row has null player FKs. Almost always
            means the live-poller created a thin row (step-4 fallback) and padelapi never got
            a chance to populate it — e.g., Premier tournaments where the entry-list widget
            returns &quot;coming soon&quot; at tournament start.
          </p>
          <p>
            <strong>Mitigation:</strong> PR #2 (2026-04-22) adds the padelapi-twin fallback
            inside <code>findOrCreateMatch</code>. New matches now link to padelapi&apos;s
            existing populated row before creating a thin duplicate. Old thin rows can be
            patched manually by copying pair FKs from the padelapi twin.
          </p>
        </Callout>

        <Callout
          variant="warning"
          title="Symptom: serving indicator missing on canonical live UI"
        >
          <p>
            <strong>Likely cause:</strong> stale{' '}
            <code>resolvedPlayersCache</code> inside <code>LivePollerLoop</code>. The cache
            was populated when player FKs were null, and PR #3&apos;s fix (re-read when any
            FK is null) handles this automatically going forward.
          </p>
          <p>
            <strong>Recovery:</strong> a Railway restart clears the cache. Any deploy to
            padelgod does this as a side effect.
          </p>
        </Callout>

        <h2>Related</h2>
        <ul>
          <li>
            <Link href="/padelgodapi/workers/live-poller-manager">
              Worker: live-poller-manager
            </Link>
          </li>
          <li>
            <Link href="/padelgodapi/workers/shadow-diff-live">
              Worker: shadow-diff-live
            </Link>
          </li>
          <li>
            <Link href="/padelgodapi/workers/static-reconciler">
              Worker: static-reconciler
            </Link>
          </li>
          <li>
            <Link href="/padelgodapi/data-model">Data model reference</Link>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/pipelines/live-scoring" />
    </article>
  )
}
