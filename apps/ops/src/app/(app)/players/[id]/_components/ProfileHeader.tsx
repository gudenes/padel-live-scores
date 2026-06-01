// apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx
// Top-of-page identity card for the full player profile.
// Pure presentation: avatar (or initials), name, country + category + ranking,
// birthdate + age, public_id, and two action links (public page, drawer).

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

  return (
    <div className="flex gap-6 items-start">
      {player.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatar_url}
          alt={player.name}
          className="w-24 h-24 rounded-full object-cover border"
          style={{
            background: 'var(--bg-hover)',
            borderColor: 'var(--border-card)',
          }}
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
