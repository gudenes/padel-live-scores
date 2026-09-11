'use client'
// apps/ops/src/app/(app)/players/[id]/_components/ProfileSection.tsx
// Editable card for the player's profile fields. Save-on-blur: each input fires
// a PATCH to /api/internal/player/[id] with `{ [field]: value }` when it loses
// focus. The PATCH route's allow-list (route.ts:PATCHABLE_FIELDS) gates which
// fields are accepted — keep this in sync.
//
// Local state mirrors the server so subsequent edits see the latest value; on
// save failure we alert() the response text. v1 keeps this dead-simple.

import { useRef, useState } from 'react'
import { Panel } from '@/components/ui'
import Combobox, { type ComboboxOption } from '../../_components/Combobox'
import { COUNTRY_OPTIONS } from '@/lib/country'

// Birthdate may arrive as either 'YYYY-MM-DD' or a full ISO timestamp depending on
// Supabase column type. <input type="date"> only accepts YYYY-MM-DD as defaultValue.
function toDateInputValue(v: string | null): string {
  if (!v) return ''
  return v.slice(0, 10)
}

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

interface SelectOption {
  value: string
  label: string
}

interface FieldDef {
  key: EditableField
  label: string
  type?: 'text' | 'date' | 'select' | 'country'
  // Only for type: 'select'. Does not need to include the empty/unset
  // option — that's added by the renderer.
  options?: SelectOption[]
}

// Real, enforced vocabularies — see the code that actually tests these
// values (src/app/[locale]/player/[id]/page.tsx, AmateurProfile.tsx,
// SummaryTab.tsx, PlayerCard.tsx). The old free-text labels ("Side
// (left|right)") lied about this: `side` has never accepted 'left'/'right',
// only 'drive'/'backhand'.
const SIDE_OPTIONS: SelectOption[] = [
  { value: 'drive', label: 'Drive' },
  { value: 'backhand', label: 'Backhand' },
]
const HAND_OPTIONS: SelectOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]
const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
]

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Full name' },
  { key: 'display_name', label: 'Display name' },
  { key: 'country', label: 'Country', type: 'country' },
  { key: 'category', label: 'Category', type: 'select', options: CATEGORY_OPTIONS },
  { key: 'side', label: 'Side', type: 'select', options: SIDE_OPTIONS },
  { key: 'hand', label: 'Hand', type: 'select', options: HAND_OPTIONS },
  { key: 'height', label: 'Height (cm)' },
  { key: 'birthdate', label: 'Birthdate', type: 'date' },
  { key: 'birthplace', label: 'Birthplace' },
]

// Combobox needs an explicit "no selection" row since it only shows the
// placeholder for `value === null`, not for an empty-string id. Prepending
// this lets the operator clear the field back to unset.
const UNSET_COUNTRY_OPTION: ComboboxOption = { id: '', label: '(unset)' }

const COUNTRY_COMBOBOX_OPTIONS: ComboboxOption[] = [
  UNSET_COUNTRY_OPTION,
  ...COUNTRY_OPTIONS.map((c) => ({ id: c.code, label: c.name, sublabel: c.code })),
]

// A select whose current DB value isn't in the known vocabulary (e.g. the
// dirty 'Right'/'Left' rows, or a legacy free-text country code no longer
// resolvable) must still show the operator what's actually stored, not
// silently fall back to blank-and-unsaved. We inject a clearly-marked extra
// option for exactly that value rather than auto-correcting it — a separate
// cleanup script owns fixing the data.
function optionsWithCurrentValue(base: SelectOption[], current: string | null): SelectOption[] {
  if (!current) return base
  if (base.some((o) => o.value === current)) return base
  return [...base, { value: current, label: `${current} (unrecognized — stored as-is)` }]
}

function countryOptionsWithCurrentValue(current: string | null): ComboboxOption[] {
  if (!current || current === '') return COUNTRY_COMBOBOX_OPTIONS
  if (COUNTRY_COMBOBOX_OPTIONS.some((o) => o.id === current)) return COUNTRY_COMBOBOX_OPTIONS
  return [
    ...COUNTRY_COMBOBOX_OPTIONS,
    { id: current, label: `${current} (unrecognized — stored as-is)` },
  ]
}

export default function ProfileSection({
  player: initial,
}: {
  player: ProfileSectionPlayer
}) {
  const [player, setPlayer] = useState<ProfileSectionPlayer>(initial)
  const [saving, setSaving] = useState<string | null>(null)

  // Track committed values per field so blur-without-change is a no-op.
  // This prevents a tab-through across 10 inputs firing 10 PATCH writes.
  const committedRef = useRef<Record<string, string>>({})

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
    <Panel title="Profile">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <div
              className="text-[11px] uppercase tracking-wide mb-1"
              style={{ color: 'var(--text-3)' }}
            >
              {f.label}
              {saving === f.key && (
                <span
                  className="normal-case ml-2"
                  style={{ color: 'var(--lime-text)' }}
                >
                  saving…
                </span>
              )}
            </div>
            {f.type === 'select' ? (
              <select
                defaultValue={player[f.key] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  committedRef.current[f.key] = raw
                  const v = raw || null
                  setPlayer((p) => ({ ...p, [f.key]: v }))
                  save(f.key, v)
                }}
                className="w-full px-2 py-1.5 text-sm border rounded"
                style={{
                  borderColor: 'var(--border-card)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-1)',
                }}
              >
                <option value="">(unset)</option>
                {optionsWithCurrentValue(f.options ?? [], player[f.key]).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'country' ? (
              <Combobox
                options={countryOptionsWithCurrentValue(player.country)}
                value={player.country ?? ''}
                placeholder="Select a country"
                onChange={(id) => {
                  const v = id ? id.toUpperCase() : null
                  committedRef.current.country = v ?? ''
                  setPlayer((p) => ({ ...p, country: v }))
                  save('country', v)
                }}
              />
            ) : (
              <input
                type={f.type ?? 'text'}
                defaultValue={
                  f.type === 'date'
                    ? toDateInputValue(player[f.key])
                    : player[f.key] ?? ''
                }
                onBlur={(e) => {
                  const raw = e.target.value
                  const initial = committedRef.current[f.key] ?? (player[f.key] ?? '')
                  if (raw === initial) return // no-op blur
                  committedRef.current[f.key] = raw
                  const v = raw || null
                  setPlayer((p) => ({ ...p, [f.key]: v }))
                  save(f.key, v)
                }}
                className="w-full px-2 py-1.5 text-sm border rounded"
                style={{
                  borderColor: 'var(--border-card)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-1)',
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div
          className="text-[11px] uppercase tracking-wide mb-1"
          style={{ color: 'var(--text-3)' }}
        >
          Coaches
          {saving === 'coaches' && (
            <span
              className="normal-case ml-2"
              style={{ color: 'var(--lime-text)' }}
            >
              saving…
            </span>
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
            const prevJson = committedRef.current.coaches ?? JSON.stringify(player.coaches ?? [])
            const nextJson = JSON.stringify(arr)
            if (nextJson === prevJson) return // no-op blur
            committedRef.current.coaches = nextJson
            setPlayer((p) => ({ ...p, coaches: arr }))
            save('coaches', arr)
          }}
          placeholder="comma-separated"
          className="w-full px-2 py-1.5 text-sm border rounded"
          style={{
            borderColor: 'var(--border-card)',
            background: 'var(--bg-card)',
            color: 'var(--text-1)',
          }}
        />
      </div>
    </Panel>
  )
}
