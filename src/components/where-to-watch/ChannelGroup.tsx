'use client'

import { useTranslations } from 'next-intl'
import type { ChannelGroup as ChannelGroupData } from '@/lib/where-to-watch/group-builder'
import { BroadcasterRow } from './BroadcasterRow'

const YT_RED = '#FF0000'
const RED = '#FF4655'
const RED_SOFT = 'rgba(255,70,85,0.16)'
const MUTED = '#9CA3AF'
const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

// ISO2 → display name map. Lives here (mirrored from WhereToWatch.tsx)
// because both this file and RegionPicker need it; keeping it inline
// avoids a third file for ~36 entries.
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

export interface ChannelGroupProps {
  group: ChannelGroupData
  groupIndex: number
  country: string | null
  onCloseRequested?: () => void  // close popup after CTA click
}

export function ChannelGroup({ group, groupIndex, country, onCloseRequested }: ChannelGroupProps) {
  const t = useTranslations('whereToWatch')
  const regionName = country ? (ISO2_TO_NAME[country.toLowerCase()] ?? country.toUpperCase()) : null

  return (
    <div
      data-wtw-anim
      style={{
        paddingTop: groupIndex === 0 ? 0 : 14,
        marginTop: groupIndex === 0 ? 0 : 14,
        borderTop: groupIndex === 0 ? 'none' : `1px solid rgba(255,255,255,0.06)`,
        animation: `wtw-row-pop 420ms cubic-bezier(0.4, 0, 0.2, 1) ${180 + groupIndex * 100}ms both`,
      }}
    >
      {/* Channel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: group.colorHex,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: '#fff',
          fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
        }}>
          {group.abbreviation}
        </div>
        <div style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
          color: '#fff', lineHeight: 1.2, textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {group.channelName}
          </span>
          {group.hasLive && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
              color: RED, background: RED_SOFT,
              padding: '1px 5px', clipPath: CLIP_BADGE,
              lineHeight: 1.4, flexShrink: 0,
            }}>
              {t('channelLive')}
            </span>
          )}
        </div>
      </div>

      {/* Live YT streams (when present) */}
      {group.hasLive && (
        <div style={{ marginLeft: 40, display: 'flex', flexDirection: 'column' }}>
          {group.liveStreams.map((stream, si) => (
            <div
              key={stream.videoId}
              data-wtw-anim
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                animation: `wtw-stream-in 280ms cubic-bezier(0.4, 0, 0.2, 1) ${280 + groupIndex * 100 + si * 50}ms both`,
              }}
            >
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: 11, color: '#D8D8DD', lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
              }}>{stream.title}</div>
              <a
                href={youtubeWatchUrl(stream.videoId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onCloseRequested}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: '#fff', background: YT_RED,
                  padding: '5px 10px',
                  clipPath: CLIP_BADGE,
                  textDecoration: 'none',
                }}
              >
                <svg viewBox="0 0 24 24" width="10" height="10" fill="#fff" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                {t('watchCta')}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* "No free YT, also on:" helper line (only when there are broadcasters AND no live YT) */}
      {!group.hasLive && group.broadcasters.length > 0 && (
        <div style={{
          marginLeft: 40, marginBottom: 8,
          fontSize: 10, color: MUTED, lineHeight: 1.4,
        }}>
          {t('noFreeStream', { channel: group.channelName })}
        </div>
      )}

      {/* Nested regional broadcaster section */}
      {group.broadcasters.length > 0 && (
        <>
          {group.hasLive && regionName && (
            <div style={{
              margin: '8px 0 4px 40px',
              fontSize: 8.5, color: MUTED, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.8,
            }}>
              {t('alsoIn', { region: regionName })}
            </div>
          )}
          <div style={{ marginLeft: 40, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {group.broadcasters.map(b => (
              <BroadcasterRow
                key={b.id}
                name={b.name}
                logoUrl={b.logoUrl}
                url={b.url}
                isFree={b.isFree}
                onNavigate={onCloseRequested}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
