// src/app/padelgodapi/data-model/page.tsx
// Reference — the top-level public tables that the future API will expose.

import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { PrevNextLinks } from '../_components/PrevNextLinks'
import { Callout } from '../_components/Callout'

export const metadata: Metadata = { title: 'Data model' }

interface Field {
  name: string
  type: string
  nullable?: boolean
  description: string
}

function SchemaTable({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div className="my-8">
      <h3 className="mb-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-base)]">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                Column
              </th>
              <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                Type
              </th>
              <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <tr key={f.name} className="hover:bg-[var(--bg-subtle)]">
                <td className="border-b border-[var(--border-base)] px-3 py-2 align-top font-mono text-xs text-[var(--text-primary)]">
                  {f.name}
                  {f.nullable && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      null?
                    </span>
                  )}
                </td>
                <td className="border-b border-[var(--border-base)] px-3 py-2 align-top font-mono text-xs text-[var(--color-accent)]">
                  {f.type}
                </td>
                <td className="border-b border-[var(--border-base)] px-3 py-2 align-top text-sm text-[var(--text-secondary)]">
                  {f.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DataModelPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Reference"
        title="Data model"
        description="The canonical public.* tables that padelgod populates — what the UI reads, and what the public API will expose."
      />
      <Prose>
        <h2>Canonical ID pattern</h2>
        <p>
          Every entity (tournament, player, match) has a <code>id UUID</code> primary key — the
          canonical PadelGod ID. External source IDs are secondary identifiers:
        </p>
        <ul>
          <li>
            Top-2 sources get dedicated indexed columns (e.g. <code>tournaments.padelapi_id</code>,
            <code>players.fip_id</code>) for zero-cost lookups on hot paths.
          </li>
          <li>
            Every other source uses the polymorphic <code>entity_external_ids</code> sidecar table.
            Adding a new source = zero schema changes.
          </li>
        </ul>

        <Callout variant="info" title="Why not use the source ID as the primary key?">
          Because sources change and merge. A player can appear on padelapi, FIP, and Premier Padel
          with three different IDs. A tournament can be listed on matchscorerlive and padelfip with
          different slugs. The canonical UUID decouples our data model from any single source&apos;s
          ID system.
        </Callout>

        <h2>The four core tables</h2>

        <SchemaTable
          title="public.tournaments"
          fields={[
            { name: 'id', type: 'uuid', description: 'Canonical primary key. Used in all UI URLs.' },
            { name: 'name', type: 'text', description: 'Display name, e.g. "FIP BRONZE IJUÍ".' },
            { name: 'level', type: 'text', description: 'Tier slug: premier_major, p1, p2, fip_platinum, fip_gold, fip_silver, fip_other (Bronze + Cupra).' },
            { name: 'country', type: 'text', nullable: true, description: 'ISO 2-letter country code of the host venue.' },
            { name: 'starts_at', type: 'timestamptz', nullable: true, description: 'Tournament first day, 00:00 UTC.' },
            { name: 'ends_at', type: 'timestamptz', nullable: true, description: 'Tournament last day, 00:00 UTC.' },
            { name: 'logo_url', type: 'text', nullable: true, description: 'CDN URL for the tournament logo. Preferred size is 256x256.' },
            { name: 'prize_money', type: 'integer', nullable: true, description: 'Total prize in euros. null if unknown.' },
            { name: 'padelapi_id', type: 'text', nullable: true, description: 'Hot column for padelapi source IDs. Null for FIP-only tournaments.' },
            { name: 'fip_id', type: 'text', nullable: true, description: 'FIP slug, e.g. "fip-bronze-ijui-2026".' },
            { name: 'source', type: 'text', description: 'Primary source: "padelapi" | "fip" | "manual". Determines which sync jobs own it.' },
          ]}
        />

        <SchemaTable
          title="public.players"
          fields={[
            { name: 'id', type: 'uuid', description: 'Canonical primary key. Stable across source ID changes.' },
            { name: 'name', type: 'text', description: 'Display name in "Firstname Lastname" format.' },
            { name: 'country', type: 'text', nullable: true, description: 'ISO 2-letter country code.' },
            { name: 'category', type: 'text', description: '"men" | "women". Padel&apos;s competitive category system.' },
            { name: 'ranking', type: 'integer', nullable: true, description: 'Current FIP Official ranking (1 = world #1). Null if unranked.' },
            { name: 'points', type: 'integer', nullable: true, description: 'FIP Official points total.' },
            { name: 'race_ranking', type: 'integer', nullable: true, description: 'Race ranking — year-to-date standings for season-end qualifier.' },
            { name: 'birthdate', type: 'date', nullable: true, description: 'YYYY-MM-DD. Sparse — sourced from FIP profile pages.' },
            { name: 'hand', type: 'text', nullable: true, description: '"L" or "R".' },
            { name: 'height', type: 'integer', nullable: true, description: 'Height in cm.' },
            { name: 'avatar_url', type: 'text', nullable: true, description: 'CDN URL. 90% of players have no avatar today; this improves as we scrape FIP profiles.' },
            { name: 'fip_id', type: 'text', nullable: true, description: 'e.g. "fip-P100312". Used as the join key for FIP data.' },
            { name: 'padelapi_id', type: 'text', nullable: true, description: 'Numeric padelapi ID as a string.' },
          ]}
        />

        <SchemaTable
          title="public.matches"
          fields={[
            { name: 'id', type: 'uuid', description: 'Canonical primary key.' },
            { name: 'tournament_id', type: 'uuid', description: 'FK → public.tournaments.id.' },
            { name: 'round', type: 'text', nullable: true, description: 'Round label: "R32", "R16", "QF", "SF", "F", "Q" (qualifying), "bye".' },
            { name: 'category', type: 'text', description: '"men" | "women".' },
            { name: 'status', type: 'text', description: '"scheduled" | "live" | "ended" | "finished" | "retired" | "walkover" | "bye".' },
            { name: 'scheduled_at', type: 'timestamptz', nullable: true, description: 'Start time in UTC. Rendered in the viewer&apos;s local timezone.' },
            { name: 'court', type: 'text', nullable: true, description: 'Court name or number, as published by the tour.' },
            { name: 'pair1_player1_id', type: 'uuid', nullable: true, description: 'First player of pair 1. FK → public.players.id. Null if unresolved.' },
            { name: 'pair1_player2_id', type: 'uuid', nullable: true, description: 'Second player of pair 1.' },
            { name: 'pair2_player1_id', type: 'uuid', nullable: true, description: 'First player of pair 2.' },
            { name: 'pair2_player2_id', type: 'uuid', nullable: true, description: 'Second player of pair 2.' },
            { name: 'winner_pair', type: 'integer', nullable: true, description: '1 or 2. Null until the match has a determined winner.' },
            { name: 'coverage', type: 'text', nullable: true, description: '"full" | "partial" | null. Reflects completeness of point-by-point data.' },
            { name: 'padelapi_id', type: 'text', nullable: true, description: 'Padelapi match ID. Null for FIP-only matches.' },
            { name: 'pusher_channel', type: 'text', nullable: true, description: 'Pusher WebSocket channel subscribed by the Railway relay. Live scoring only.' },
          ]}
        />

        <SchemaTable
          title="public.sets"
          fields={[
            { name: 'id', type: 'uuid', description: 'Primary key.' },
            { name: 'match_id', type: 'uuid', description: 'FK → public.matches.id.' },
            { name: 'set_number', type: 'integer', description: '1, 2, or 3 (padel is best-of-3).' },
            { name: 'set_score', type: 'text', nullable: true, description: 'Concise form like "6-4", "7-6", "6-0". Null while a set is in progress.' },
            { name: 'pair1_games', type: 'integer', nullable: true, description: 'Games won in this set by pair 1.' },
            { name: 'pair2_games', type: 'integer', nullable: true, description: 'Games won in this set by pair 2.' },
            { name: 'is_current', type: 'boolean', description: 'True on exactly one set per live match — the one currently in progress.' },
            { name: 'score_source', type: 'text', description: 'Priority: "api" > "live" > "shadow" > "inferred". Higher-priority sources overwrite lower; same-or-lower are ignored.' },
          ]}
        />

        <h2>Relationships at a glance</h2>
        <pre>
          <code>{`tournaments (1) ── (*) matches ── (*) sets ── (*) games ── points[]
                    │
                    └── (*) tournament_draws  (bracket structure)

players (*) ←──────── (4 FKs per match) — pair1_player1, pair1_player2,
                                          pair2_player1, pair2_player2

entity_external_ids — polymorphic sidecar for all non-hot source IDs
                       (source, entity_type, entity_id, external_id)`}</code>
        </pre>

        <h2>Source priority rules</h2>
        <p>
          When multiple sources claim the same field, priority rules decide who wins. These are
          code-defined in <code>src/lib/source-priority.ts</code> and reviewed via PR:
        </p>
        <ul>
          <li><code>player.name</code>: padelapi &gt; fip &gt; manual</li>
          <li><code>player.ranking</code>: fip_official &gt; fip &gt; padelapi</li>
          <li><code>player.avatar_url</code>: padelapi &gt; fip &gt; manual</li>
          <li><code>tournament.name</code>: padelapi &gt; fip &gt; manual</li>
          <li><code>tournament.logo_url</code>: fip &gt; padelapi &gt; manual</li>
          <li><code>match.sets</code>: padelapi &gt; simulated</li>
        </ul>

        <Callout variant="note" title="Internal tables">
          The <code>padelgod.*</code> schema holds snapshot and shadow tables. They&apos;re not
          intended for direct consumption by the UI or future public API — they exist so
          reconcilers can do their job. Future docs will reference them where useful; for now, the
          canonical public.* tables are what matters.
        </Callout>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/data-model" />
    </article>
  )
}
