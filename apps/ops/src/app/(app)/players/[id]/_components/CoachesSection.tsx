'use client'
// apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx
// Coaches OF this player. Linked coaches link to their coach record; raw
// strings not yet linked by coach-linker are shown as plain text. Editing the
// raw list happens in ProfileSection above (next linker run picks it up).

import Link from 'next/link'
import { Panel, Pill } from '@/components/ui'

export interface CoachLink {
  raw_name: string
  position: number
  coach: { id: string; display_name: string; status: string } | null
}

export default function CoachesSection({ coaches, links }: { coaches: string[] | null; links: CoachLink[] }) {
  const raw = coaches ?? []
  if (raw.length === 0 && links.length === 0) {
    return (
      <Panel title="Coaches">
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          No coaches recorded. Edit in the Profile section above.
        </div>
      </Panel>
    )
  }
  const linkedRaw = new Set(links.map((l) => l.raw_name))
  return (
    <Panel title="Coaches">
      <ul className="list-disc list-inside text-xs space-y-0.5" style={{ color: 'var(--text-2)' }}>
        {links.map((l) => l.coach && (
          <li key={l.coach.id}>
            <Link href={`/players/coaches/${l.coach.id}`}>{l.coach.display_name}</Link>
            {l.coach.display_name !== l.raw_name && <span style={{ color: 'var(--text-4)' }}> (FIP: {l.raw_name})</span>}
            {l.coach.status === 'junk' && <> <Pill tone="neutral">junk</Pill></>}
          </li>
        ))}
        {raw.filter((r) => !linkedRaw.has(r)).map((r) => (
          <li key={r}>{r} <span style={{ color: 'var(--text-4)' }}>(not linked yet)</span></li>
        ))}
      </ul>
    </Panel>
  )
}
