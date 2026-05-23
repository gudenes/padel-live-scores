'use client'
// apps/ops/src/app/(app)/players/[id]/_components/ProfileSection.tsx
// Editable card for the player's profile fields. Save-on-blur: each input fires
// a PATCH to /api/internal/player/[id] with `{ [field]: value }` when it loses
// focus. The PATCH route's allow-list (route.ts:PATCHABLE_FIELDS) gates which
// fields are accepted — keep this in sync.
//
// Local state mirrors the server so subsequent edits see the latest value; on
// save failure we alert() the response text. v1 keeps this dead-simple.

import { useState } from 'react'

export interface ProfileSectionPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  side: string | null
  height: string | null
  birthdate: string | null
  birthplace: string | null
  hand: string | null
  coaches: string[] | null
}

type EditableField = Exclude<keyof ProfileSectionPlayer, 'id' | 'coaches'>

interface FieldDef {
  key: EditableField
  label: string
  type?: 'text' | 'date'
}

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Full name' },
  { key: 'display_name', label: 'Display name' },
  { key: 'country', label: 'Country code' },
  { key: 'category', label: 'Category (men|women)' },
  { key: 'side', label: 'Side (left|right)' },
  { key: 'hand', label: 'Hand (left|right)' },
  { key: 'height', label: 'Height (cm)' },
  { key: 'birthdate', label: 'Birthdate', type: 'date' },
  { key: 'birthplace', label: 'Birthplace' },
]

export default function ProfileSection({
  player: initial,
}: {
  player: ProfileSectionPlayer
}) {
  const [player, setPlayer] = useState<ProfileSectionPlayer>(initial)
  const [saving, setSaving] = useState<string | null>(null)

  async function save(field: keyof ProfileSectionPlayer, value: unknown) {
    setSaving(field as string)
    try {
      const res = await fetch(`/api/internal/player/${player.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const text = await res.text()
        alert(`Save failed: ${text}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      alert(message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Profile</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              {f.label}
              {saving === f.key && (
                <span className="text-blue-500 normal-case ml-2">saving…</span>
              )}
            </div>
            <input
              type={f.type ?? 'text'}
              defaultValue={player[f.key] ?? ''}
              onBlur={(e) => {
                const v = e.target.value || null
                setPlayer((p) => ({ ...p, [f.key]: v }))
                save(f.key, v)
              }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-white"
            />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
          Coaches
          {saving === 'coaches' && (
            <span className="text-blue-500 normal-case ml-2">saving…</span>
          )}
        </div>
        <input
          type="text"
          defaultValue={(player.coaches ?? []).join(', ')}
          onBlur={(e) => {
            const arr = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            setPlayer((p) => ({ ...p, coaches: arr }))
            save('coaches', arr)
          }}
          placeholder="comma-separated"
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-white"
        />
      </div>
    </section>
  )
}
