'use client'
// apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx
// Read-only list of coach names. Editing happens in ProfileSection above —
// this section just surfaces the saved value for at-a-glance scanning.

export default function CoachesSection({ coaches }: { coaches: string[] | null }) {
  if (!coaches || coaches.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Coaches</h2>
        <div className="text-xs text-gray-400">
          No coaches recorded. Edit in the Profile section above.
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Coaches</h2>
      <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">
        {coaches.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  )
}
