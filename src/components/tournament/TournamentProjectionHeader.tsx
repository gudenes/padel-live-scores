'use client'
// src/components/tournament/TournamentProjectionHeader.tsx
// Header for the projection routes. Deliberately simpler than the main page's
// collapsing hero (no scroll-collapse). Marked 'use client' because it renders
// FlagImage, which attaches an onError handler to its <img> (an interactive
// prop that can't render inside a Server Component). It still SSRs to HTML on
// first paint, so the <h1>, cover image, and M/W <Link>s stay crawlable.
// The SEO-critical projection content lives in the separate server-rendered
// ProjectionSeoBlock, which is unaffected.

import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { FlagImage } from '@/components/FlagImage'
import { getTierPill } from '@/lib/tournament-tier-style'
import { levelLabel } from '@/lib/tournament-labels'
import type { ProjectionTournamentMeta, ProjectionCategory } from '@/lib/projection-server'

const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export function TournamentProjectionHeader({
  tournament,
  category,
}: {
  tournament: ProjectionTournamentMeta
  category: ProjectionCategory
}) {
  const base = `/tournaments/${tournament.id}/projection`
  const title = tournament.name ?? 'Tournament'

  return (
    <header style={{ position: 'relative', background: '#0A0A0A', overflow: 'hidden' }}>
      {tournament.cover_image_url ? (
        <>
          <Image
            src={tournament.cover_image_url}
            alt=""
            aria-hidden
            fill
            sizes="(max-width: 480px) 100vw, 500px"
            style={{ objectFit: 'cover', objectPosition: 'center top', filter: 'brightness(0.4) saturate(0.7)' }}
          />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,10,0.55)' }} />
        </>
      ) : null}

      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px 16px', minHeight: 120 }}>
        <Link href={`/tournaments/${tournament.id}?tab=overview`} aria-label="Back" style={{ color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          ‹ {title}
        </Link>

        {tournament.level ? (() => {
          const pill = getTierPill(tournament.level)
          return (
            <div style={{ marginTop: 10 }}>
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, color: pill.color, background: pill.background, clipPath: CHUNKY_BADGE, padding: '4px 12px', letterSpacing: 0.7, textTransform: 'uppercase' }}>
                {levelLabel(tournament.level)}
              </span>
            </div>
          )
        })() : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {tournament.country ? <FlagImage country={tournament.country} size={22} /> : null}
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, lineHeight: 1.05, letterSpacing: -0.5, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}>
            {title}
          </h1>
        </div>

        {/* M/W as navigations — both crawlable */}
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 12 }}>
          {(['men', 'women'] as ProjectionCategory[]).map((c) => (
            <Link
              key={c}
              href={`${base}?category=${c}`}
              aria-current={category === c ? 'true' : undefined}
              style={{
                fontSize: 11, fontWeight: 800, padding: '5px 12px', textDecoration: 'none',
                clipPath: CHUNKY_BADGE,
                background: category === c ? '#7ED321' : 'rgba(255,255,255,0.08)',
                color: category === c ? '#000' : '#9AAEC4',
              }}
            >
              {c === 'men' ? 'M' : 'W'}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
