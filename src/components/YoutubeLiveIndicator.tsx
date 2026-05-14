'use client'
// src/components/YoutubeLiveIndicator.tsx
//
// Page-level YouTube live indicator on /matches/[date]. Sits LEFT of
// the EN VIVO pill in MatchesFilterBar. Hidden when no channels are
// live. Tap → inline panel below the filter bar with one row per live
// channel: avatar + name + LIVE chip + stream title + VER button (opens
// YouTube externally).
//
// Visual reference: public/mockup-live-stream-indicator.html
// Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'

const YT_RED = '#FF0000'
const RED = '#FF4655'
const RED_SOFT = 'rgba(255,70,85,0.16)'
const MUTED_2 = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.06)'
const BG_ELEV = '#1e1e1e'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}

export interface YoutubeLiveIndicatorProps {
  liveChannels: LiveChannel[]
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

interface ChannelGroup {
  channelId: string
  name: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  streams: Array<{ videoId: string; title: string }>
}

// Group simultaneous broadcasts by channel so the panel renders one
// avatar header per channel + stream sub-rows beneath it. Preserves
// `displayOrder` ordering and the original stream order within each
// group (which `liveChannels` already arrives sorted by).
function groupChannels(channels: LiveChannel[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>()
  for (const c of channels) {
    let group = map.get(c.channel.id)
    if (!group) {
      group = {
        channelId: c.channel.id,
        name: c.channel.name,
        abbreviation: c.channel.abbreviation,
        colorHex: c.channel.colorHex,
        displayOrder: c.channel.displayOrder,
        streams: [],
      }
      map.set(c.channel.id, group)
    }
    group.streams.push({ videoId: c.videoId, title: c.title })
  }
  return [...map.values()].sort((a, b) => a.displayOrder - b.displayOrder)
}

export default function YoutubeLiveIndicator({ liveChannels }: YoutubeLiveIndicatorProps) {
  const t = useTranslations('daily.youtubeLive')
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Anchor coords for the portal panel — calculated from the pill's
  // bounding rect. Re-computed on open + scroll/resize while open.
  // We render into document.body to escape the matches-page sticky
  // header's `overflow: hidden`, which would otherwise clip the panel.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const updateAnchor = () => {
      const el = pillRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 8, left: rect.left })
    }
    updateAnchor()
    window.addEventListener('scroll', updateAnchor, true)
    window.addEventListener('resize', updateAnchor)
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      const insidePill = pillRef.current && target && pillRef.current.contains(target)
      const insidePanel = panelRef.current && target && panelRef.current.contains(target)
      if (!insidePill && !insidePanel) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        e.stopPropagation()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('scroll', updateAnchor, true)
      window.removeEventListener('resize', updateAnchor)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Hidden when nothing is live.
  if (liveChannels.length === 0) return null

  // Each broadcast renders as its own row — when a channel runs multiple
  // simultaneous streams, the badge count = number of broadcasts, not
  // number of distinct channels.
  const count = liveChannels.length

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        aria-label={t('ariaLabel', { count })}
        aria-expanded={open}
        aria-controls={open ? 'yt-live-panel' : undefined}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '6px 10px',
          background: open ? 'rgba(255,0,0,0.18)' : 'rgba(255,0,0,0.10)',
          border: `1px solid ${open ? 'rgba(255,0,0,0.50)' : 'rgba(255,0,0,0.32)'}`,
          color: '#fff',
          clipPath: CHUNKY_BADGE,
          fontFamily: 'inherit',
        }}
      >
        <span style={{
          width: 18, height: 13, borderRadius: 3, background: YT_RED,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </span>
        <span style={{
          color: '#0A0A0A', background: '#fff',
          fontFamily: 'monospace', fontSize: 9, fontWeight: 800,
          padding: '1px 5px', borderRadius: 8, lineHeight: 1.2,
        }}>{count}</span>
        <span style={{
          color: 'rgba(255,255,255,0.7)', fontSize: 9, marginLeft: 1,
          transform: open ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.2s',
        }}>&#9660;</span>
      </button>

      {open && anchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          id="yt-live-panel"
          role="region"
          aria-label={t('panelEyebrow')}
          style={{
            position: 'fixed',
            top: anchor.top,
            left: anchor.left,
            minWidth: 320,
            maxWidth: 420,
            background: BG_ELEV,
            border: `1px solid ${BORDER}`,
            borderTop: `2px solid ${YT_RED}`,
            padding: '14px 14px 16px',
            zIndex: 1000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
            letterSpacing: 2, color: YT_RED, textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: YT_RED, boxShadow: '0 0 8px rgba(255,0,0,0.7)',
            }}/>
            {t('panelEyebrow')}
          </div>

          {groupChannels(liveChannels).map((group, gi) => (
            <div
              key={group.channelId}
              style={{
                paddingTop: gi === 0 ? 0 : 12,
                marginTop: gi === 0 ? 0 : 12,
                borderTop: gi === 0 ? 'none' : `1px solid ${BORDER}`,
              }}
            >
              {/* Channel header — avatar + name + LIVE chip + count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: group.colorHex,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, color: '#fff',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
                }}>
                  {group.abbreviation}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
                  color: '#fff', lineHeight: 1.2, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
                }}>
                  {group.name}
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
                    color: RED, background: RED_SOFT,
                    padding: '1px 5px', clipPath: CHUNKY_BADGE,
                    lineHeight: 1.4,
                  }}>{t('channelLive')}</span>
                  {group.streams.length > 1 && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: MUTED_2,
                      fontFamily: 'monospace', letterSpacing: 0,
                    }}>×{group.streams.length}</span>
                  )}
                </div>
              </div>

              {/* Stream sub-rows — indented under the channel header */}
              <div style={{ marginLeft: 48, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.streams.map(stream => (
                  <div
                    key={stream.videoId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 0',
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
                      onClick={() => setOpen(false)}
                      style={{
                        flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: '#fff', background: YT_RED,
                        padding: '6px 11px',
                        clipPath: CHUNKY_BADGE,
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
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
