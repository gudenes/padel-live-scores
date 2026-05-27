// apps/ops/src/components/Odds/TournamentOutlookCard.tsx
// One card per ongoing in-scope tournament showing top 4 pairs.

export interface TournamentOutlookCardProps {
  tournamentId: string
  tournamentName: string
  category: 'men' | 'women'
  entryRound: string
  snapshotAt: string
  top: Array<{
    pairName: string
    seed: number | null
    champ_prob: number
    finalist_prob: number
    semi_prob: number
  }>
}

export function TournamentOutlookCard(props: TournamentOutlookCardProps) {
  const { tournamentId, tournamentName, category, entryRound, snapshotAt, top } = props
  return (
    <a
      href={`/odds/tournament/${tournamentId}`}
      style={{
        display: 'block',
        padding: 16,
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-canvas)',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{tournamentName}</div>
        <div style={{ fontSize: 11, color: 'var(--status-neutral)' }}>
          {category} · entry {entryRound} · snapshot {snapshotAt.slice(11, 16)}
        </div>
      </div>
      {top.slice(0, 4).map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
          {p.seed && <span style={{ color: 'var(--status-neutral)' }}>[{p.seed}]</span>}
          <span style={{ flex: 1 }}>{p.pairName}</span>
          <span style={{ minWidth: 48, textAlign: 'right', fontWeight: 600 }}>
            {(p.champ_prob * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </a>
  )
}
