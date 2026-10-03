'use client'
// apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx
// Coaches OF this player. Linked coaches link to their coach record; raw
// strings not yet linked by coach-linker are shown as plain text. Editing the
// raw list happens in ProfileSection above (next linker run picks it up).

import Link from 'next/link'
import { useState } from 'react'
import CoachPhotoUpload from '@/components/CoachPhotoUpload'
import { Panel, Pill } from '@/components/ui'

export interface CoachLink {
  raw_name: string
  position: number
  coach: { id: string; display_name: string; status: string; avatar_url?: string | null } | null
}

function LinkedCoach({ link }: { link: CoachLink }) {
  const coach = link.coach!
  const [photo, setPhoto] = useState<string | null | undefined>(undefined)
  return (
    <li className="py-2">
      <Link href={`/players/coaches/${coach.id}`} className="underline underline-offset-2">{coach.display_name}</Link>
      {coach.display_name !== link.raw_name && <span style={{ color: 'var(--text-4)' }}> (FIP: {link.raw_name})</span>}
      {coach.status === 'junk' && <> <Pill tone="neutral">junk</Pill></>}
      <CoachPhotoUpload coachId={coach.id} name={coach.display_name} url={photo === undefined ? coach.avatar_url ?? null : photo} onSaved={setPhoto} />
    </li>
  )
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
  const linkedRaw = new Set(links.filter((l) => l.coach).map((l) => l.raw_name))
  return (
    <Panel title="Coaches">
      <ul className="text-xs space-y-2" style={{ color: 'var(--text-2)' }}>
        {links.map((l) => l.coach && <LinkedCoach key={l.coach.id} link={l} />)}
        {raw.filter((r) => !linkedRaw.has(r)).map((r) => (
          <li key={r}>{r} <span style={{ color: 'var(--text-4)' }}>(not linked yet)</span></li>
        ))}
      </ul>
    </Panel>
  )
}
