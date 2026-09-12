'use client'
// apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx
// Top-of-page identity card for the full player profile.
// Pure presentation: avatar (or initials), name, country + category + ranking,
// birthdate + age, public_id, and two action links (public page, drawer).
// Amateur players also get an inline photo-upload control (see Task 3/4 of
// docs/superpowers/plans/2026-09-09-admin-amador-v2.md) — professionals don't,
// since a manual avatar there would be overwritten by the padelapi sync.

import { useRef, useState } from 'react'
import Link from 'next/link'

export interface ProfileHeaderPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  ranking: number | null
  birthdate: string | null
  avatar_url: string | null
  photo_url: string | null
  public_id: string | null
  slug: string | null
  tier: string | null
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function ageLabel(birthdate: string | null): string {
  if (!birthdate) return ''
  const b = new Date(birthdate)
  if (Number.isNaN(b.getTime())) return ''
  const now = new Date()
  const beforeBirthday =
    now < new Date(now.getFullYear(), b.getMonth(), b.getDate())
  const yrs = now.getFullYear() - b.getFullYear() - (beforeBirthday ? 1 : 0)
  if (yrs < 0 || yrs > 120) return ''
  return `(${yrs}y)`
}

function countryName(code: string | null): string {
  if (!code) return ''
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ??
      code
    )
  } catch {
    return code
  }
}

export default function ProfileHeader({ player }: { player: ProfileHeaderPlayer }) {
  const publicHref = player.public_id
    ? `https://padelnachos.com/player/${player.slug ?? player.public_id}`
    : null
  const displayName = player.display_name ?? player.name

  const [avatarUrl, setAvatarUrl] = useState(player.avatar_url)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isAmateur = player.tier === 'amateur'

  async function handleFile(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('playerId', player.id)
      const up = await fetch('/api/internal/upload-player-avatar', { method: 'POST', body: form })
      const upBody = await up.json()
      if (!up.ok) throw new Error(upBody.error ?? 'upload failed')

      const patch = await fetch(`/api/internal/player/${player.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: upBody.url }),
      })
      if (!patch.ok) throw new Error((await patch.json()).error ?? 'save failed')

      setAvatarUrl(upBody.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex gap-6 items-start">
      <div className="relative">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={player.name}
            className="w-24 h-24 rounded-full object-cover border"
            style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-card)' }}
          />
        ) : (
          <div
            className="w-24 h-24 rounded-full border flex items-center justify-center text-2xl font-bold"
            style={{
              background: 'var(--bg-hover)',
              borderColor: 'var(--border-card)',
              color: 'var(--text-3)',
            }}
          >
            {initials(displayName)}
          </div>
        )}
        {isAmateur && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-2 w-24 px-2 py-1 text-xs border rounded cursor-pointer"
              style={{
                borderColor: 'var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-1)',
              }}
            >
              {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Add photo'}
            </button>
            {uploadError && (
              <div className="mt-1 w-24 text-xs" style={{ color: 'var(--text-danger, #e24b4a)' }}>
                {uploadError}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>
          {displayName}
        </div>
        <div className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          {player.country && <>{countryName(player.country)}</>}
          {player.category && (
            <> · {player.category === 'men' ? 'Men' : 'Women'}</>
          )}
          {player.ranking != null && <> · #{player.ranking}</>}
        </div>
        {player.birthdate && (
          <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Born {player.birthdate} {ageLabel(player.birthdate)}
          </div>
        )}
        {player.public_id && (
          <div className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
            public_id: <span className="font-mono">{player.public_id}</span>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          {publicHref && (
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs border rounded cursor-pointer"
              style={{
                borderColor: 'var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-1)',
              }}
            >
              Open public page ↗
            </a>
          )}
          <Link
            href={`/players?drawer=${player.id}`}
            className="px-3 py-1.5 text-xs border rounded cursor-pointer"
            style={{
              borderColor: 'var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-1)',
            }}
          >
            Open in drawer
          </Link>
        </div>
      </div>
      {player.photo_url && (
        <div className="flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={player.photo_url}
            alt={`${player.name} photo`}
            style={{
              width: 150,
              height: 188,
              borderRadius: 12,
              objectFit: 'cover',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-hover)',
            }}
          />
        </div>
      )}
    </div>
  )
}
