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
import { courtRank } from '@/lib/match-day-bucket'

// CSS keyframes for the modal entrance. Backdrop fades fast; modal does a
// playful pop-with-overshoot ("boing"), channel groups drop in from above
// with their own bounce + stagger, and stream sub-rows cascade in horizontally.
// Disabled when the user requests reduced motion.
const YT_LIVE_KEYFRAMES = `
@keyframes yt-live-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes yt-live-pop-in {
  0%   { opacity: 0; transform: scale(0.7); }
  55%  { opacity: 1; transform: scale(1.05); }
  78%  { transform: scale(0.98); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes yt-live-eyebrow-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes yt-live-row-pop {
  0%   { opacity: 0; transform: translateY(18px) scale(0.94); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes yt-live-stream-in {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-yt-live-anim] {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
.yt-live-close-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 56px;
  height: 56px;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  color: #fff;
  font-family: inherit;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.yt-live-close-btn::before {
  content: '';
  position: absolute;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
  clip-path: polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%);
  pointer-events: none;
}
.yt-live-close-btn > span {
  position: relative;
  pointer-events: none;
}
`

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
// avatar header per channel + stream sub-rows beneath it. Channels are
// ordered by `displayOrder` ascending. Within each group, streams are
// sorted by `courtRank` (Centre/Central → 0, "Court 2" → 2, etc.) so
// the headline court appears first, matching the chronological-day-view
// tiebreak introduced in the OOP-by-time PR.
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
  for (const g of map.values()) {
    g.streams.sort((a, b) => {
      const ra = courtRank(a.title)
      const rb = courtRank(b.title)
      if (ra !== rb) return ra - rb
      return a.title.localeCompare(b.title)
    })
  }
  return [...map.values()].sort((a, b) => a.displayOrder - b.displayOrder)
}

export default function YoutubeLiveIndicator({ liveChannels }: YoutubeLiveIndicatorProps) {
  const t = useTranslations('daily.youtubeLive')
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement | null>(null)

  // Escape closes the modal. The visible backdrop handles outside-click
  // dismissal directly via its onClick — no document-level pointerdown
  // listener needed (which avoided the "click pill, listener fires before
  // setOpen" race anyway).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
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
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setOpen(false)}
          data-yt-live-anim
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            animation: 'yt-live-fade-in 180ms ease-out both',
          }}
        >
          <style>{YT_LIVE_KEYFRAMES}</style>
          <div
            id="yt-live-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t('panelEyebrow')}
            onClick={(e) => e.stopPropagation()}
            data-yt-live-anim
            style={{
              position: 'relative',
              width: 'min(380px, 92vw)',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: BG_ELEV,
              padding: '20px 20px 22px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
              clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
              animation: 'yt-live-pop-in 380ms cubic-bezier(0.4, 0, 0.2, 1) both',
              transformOrigin: 'center center',
            }}
          >
            <button
              type="button"
              className="yt-live-close-btn"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </button>
          <div data-yt-live-anim style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
            letterSpacing: 2, color: YT_RED, textTransform: 'uppercase',
            marginBottom: 10,
            animation: 'yt-live-eyebrow-in 260ms cubic-bezier(0.4, 0, 0.2, 1) 80ms both',
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
              data-yt-live-anim
              style={{
                paddingTop: gi === 0 ? 0 : 12,
                marginTop: gi === 0 ? 0 : 12,
                borderTop: gi === 0 ? 'none' : `1px solid ${BORDER}`,
                animation: `yt-live-row-pop 420ms cubic-bezier(0.4, 0, 0.2, 1) ${180 + gi * 100}ms both`,
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
                </div>
              </div>

              {/* Stream sub-rows — indented under the channel header */}
              <div style={{ marginLeft: 48, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.streams.map((stream, si) => (
                  <div
                    key={stream.videoId}
                    data-yt-live-anim
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 0',
                      animation: `yt-live-stream-in 280ms cubic-bezier(0.4, 0, 0.2, 1) ${280 + gi * 100 + si * 50}ms both`,
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
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
