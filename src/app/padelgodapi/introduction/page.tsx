// src/app/padelgodapi/introduction/page.tsx
// First read — what padelgod is, why it exists.

import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { Callout } from '../_components/Callout'
import { PrevNextLinks } from '../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Introduction' }

export default function IntroductionPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Overview"
        title="Introduction"
        description="PadelGod is the always-on scraping + reconciliation service that feeds padelnachos.com. It consolidates half a dozen fragmented padel data sources into a single clean dataset."
      />
      <Prose>
        <h2>What problem does it solve?</h2>
        <p>
          Professional padel data is scattered. Premier Padel has its own API and widget provider.
          FIP publishes draws and rankings on its own site. Live scoring for the Cupra FIP Tour is
          embedded in <code>matchscorerlive.com</code> iframes. Match statistics come from yet another
          endpoint. Entry lists arrive as PDFs on <code>padelfip.com</code>.
        </p>
        <p>
          If you want to show a live bracket for an FIP Bronze tournament next to Premier Padel P1
          results on the same page, you need to talk to all of these sources, handle their rate
          limits, parse their quirks, and stitch the results together. PadelGod does exactly that.
        </p>

        <h2>Core value</h2>
        <ul>
          <li>
            <strong>Unified data model.</strong> One schema covers tournaments, matches, sets, games,
            points, players, rankings, and stats — regardless of which upstream source the data
            originally came from.
          </li>
          <li>
            <strong>Live to the second.</strong> Active matches are polled every six seconds. Point-by-point
            reconstruction lets you replay a match game-by-game.
          </li>
          <li>
            <strong>Source transparency.</strong> Every value we surface carries its lineage
            (&apos;padelapi&apos;, &apos;fip&apos;, &apos;crionet&apos;, &apos;premierpadel&apos;) so
            downstream clients can trust the data.
          </li>
          <li>
            <strong>Reconciliation-first.</strong> Raw scrapes land in append-only snapshot tables.
            Canonical state is materialized by reconcilers — so a bad scrape can never corrupt the
            canonical data irrecoverably.
          </li>
        </ul>

        <h2>Who is this for?</h2>
        <ul>
          <li>
            <strong>padelnachos.com users</strong> — the app you&apos;re using reads directly from
            padelgod&apos;s output tables.
          </li>
          <li>
            <strong>Internal operators + engineers</strong> — these docs explain how to debug a
            worker, add a tournament, or read the data model.
          </li>
          <li>
            <strong>External developers (future)</strong> — we plan to expose a public HTTP API so
            you can build on top of the same pipeline that runs padelnachos. See the{' '}
            <a href="/padelgodapi/roadmap">roadmap</a>.
          </li>
        </ul>

        <Callout variant="info" title="What padelgod is NOT">
          Padelgod does not generate live scores — it scrapes them from official sources. It does
          not cover amateur or local club events unless those events publish via one of the tours
          we track. It is not a substitute for official tour APIs; it&apos;s a consolidation layer.
        </Callout>

        <h2>How it relates to padelnachos.com</h2>
        <p>
          Padelnachos is the consumer app. PadelGod is the data service. They share a single
          Supabase Postgres database:
        </p>
        <ul>
          <li>
            PadelGod <strong>writes</strong> to <code>public.tournaments</code>,{' '}
            <code>public.matches</code>, <code>public.sets</code>, <code>public.players</code>, plus
            its own <code>padelgod.*</code> snapshot tables.
          </li>
          <li>
            Padelnachos <strong>reads</strong> from the same <code>public.*</code> tables via
            Supabase Realtime subscriptions. When a match goes live, the UI hears about it within
            milliseconds.
          </li>
        </ul>

        <h2>Next reading</h2>
        <ul>
          <li>
            <a href="/padelgodapi/coverage">Coverage</a> — which tours and levels we currently track.
          </li>
          <li>
            <a href="/padelgodapi/architecture">Architecture</a> — the three-layer data-flow model.
          </li>
          <li>
            <a href="/padelgodapi/workers">Workers</a> — what each scheduled job does.
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/introduction" />
    </article>
  )
}
