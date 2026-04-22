// src/app/padelgodapi/page.tsx
// Landing — the front door for anyone arriving at /padelgodapi.

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'PadelGod — real-time padel tournament data',
}

interface StatCardProps {
  value: string
  label: string
  sub?: string
}
function StatCard({ value, label, sub }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-5">
      <p className="font-display text-3xl font-bold tracking-tight text-[var(--text-primary)]">
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
        {label}
      </p>
      {sub && <p className="mt-2 text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  )
}

export default function PadelGodApiLanding() {
  return (
    <div>
      {/* Hero */}
      <section className="mb-14">
        <p className="mb-4 inline-block rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          Internal preview · public API coming soon
        </p>
        <h1 className="mb-5 font-display text-4xl font-bold tracking-tight text-[var(--text-primary)] md:text-6xl">
          Real-time padel tournament data,<br />
          <span className="text-[var(--color-accent)]">consolidated across every tour.</span>
        </h1>
        <p className="mb-8 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)]">
          PadelGod is the scraping + reconciliation service behind padelnachos.com.
          It consolidates live scores, draws, results, player rankings, and match
          stats from FIP, Premier Padel, and the Cupra FIP Tour — turning half
          a dozen fragmented sources into one clean dataset.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/padelgodapi/introduction"
            className="rounded-md border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            Read the introduction →
          </Link>
          <Link
            href="/padelgodapi/coverage"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--color-accent-border)]"
          >
            See coverage
          </Link>
          <Link
            href="/padelgodapi/architecture"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--color-accent-border)]"
          >
            Architecture
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="mb-16 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          value="13"
          label="Workers"
          sub="From tournament discovery to shadow diff, running on cron"
        />
        <StatCard
          value="5+"
          label="Data sources"
          sub="Crionet, padelfip, padelapi, Premier Padel, FIP rankings"
        />
        <StatCard
          value="120+"
          label="Live tournaments"
          sub="FIP Bronze, Silver, Gold, Premier Padel — currently tracked"
        />
        <StatCard
          value="24/7"
          label="Coverage"
          sub="Live polling every 6s per active match"
        />
      </section>

      {/* What you'll find */}
      <section className="mb-16">
        <h2 className="mb-6 font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          What you&apos;ll find here
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href="/padelgodapi/introduction"
            className="group rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--color-accent-border)]"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
              Overview
            </p>
            <h3 className="mb-2 font-display text-lg font-semibold text-[var(--text-primary)] group-hover:text-[var(--color-accent)]">
              Introduction
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              What padelgod is, why it exists, and what problem it solves.
            </p>
          </Link>
          <Link
            href="/padelgodapi/architecture"
            className="group rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--color-accent-border)]"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
              How it works
            </p>
            <h3 className="mb-2 font-display text-lg font-semibold text-[var(--text-primary)] group-hover:text-[var(--color-accent)]">
              Architecture
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Three-layer pipeline: sources → snapshots → canonical tables.
            </p>
          </Link>
          <Link
            href="/padelgodapi/data-model"
            className="group rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--color-accent-border)]"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
              Reference
            </p>
            <h3 className="mb-2 font-display text-lg font-semibold text-[var(--text-primary)] group-hover:text-[var(--color-accent)]">
              Data model
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Every table, every column — the source of truth for downstream queries.
            </p>
          </Link>
        </div>
      </section>

      {/* Public API teaser */}
      <section className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card-alt)] p-6">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Developer API
            </p>
            <h3 className="mb-2 font-display text-xl font-semibold text-[var(--text-primary)]">
              A public API is on the roadmap.
            </h3>
            <p className="max-w-xl text-sm text-[var(--text-secondary)]">
              We&apos;re planning a developer-facing HTTP API with auth, rate
              limits, and webhook events — built on the same data pipeline
              powering padelnachos.com. Interested? The{' '}
              <Link href="/padelgodapi/roadmap" className="text-[var(--color-accent)] hover:underline">
                roadmap
              </Link>{' '}
              has the details.
            </p>
          </div>
          <Link
            href="/padelgodapi/roadmap"
            className="whitespace-nowrap rounded-md border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            See the roadmap
          </Link>
        </div>
      </section>
    </div>
  )
}
