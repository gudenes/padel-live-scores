'use client'
// apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx
// Read-only list of coach names. Editing happens in ProfileSection above —
// this section just surfaces the saved value for at-a-glance scanning.

import { Panel } from '@/components/ui'

export default function CoachesSection({ coaches }: { coaches: string[] | null }) {
  if (!coaches || coaches.length === 0) {
    return (
      <Panel title="Coaches">
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          No coaches recorded. Edit in the Profile section above.
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Coaches">
      <ul
        className="list-disc list-inside text-xs space-y-0.5"
        style={{ color: 'var(--text-2)' }}
      >
        {coaches.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </Panel>
  )
}
