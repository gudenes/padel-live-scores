'use client'

import React from 'react'
import type { GeniusProgressState } from '@/hooks/useGeniusProgress'
import { getTodayTheme } from '@/data/genius-themes'
import { getXpProgress } from '@/data/genius-levels'
import WeekStrip from './WeekStrip'

interface HubViewProps {
  progress: GeniusProgressState
  todayCompleted: boolean
  onStart: () => void
  onOpenAvatarPicker: () => void
}

export default function HubView({ progress, todayCompleted, onStart, onOpenAvatarPicker }: HubViewProps) {
  const theme = getTodayTheme()
  const { current, next, progress: xpProgress } = getXpProgress(progress.totalXp)

  const accuracy = progress.answeredAll.length > 0
    ? Math.round(
        (progress.answeredAll.length - progress.wrongAnswers.length) /
          progress.answeredAll.length *
          100,
      )
    : 0

  // Build completedDays from lastPlayedDate + todayDate if completed
  const completedDays: string[] = []
  if (todayCompleted) {
    completedDays.push(progress.todayDate)
  }
  // We only reliably know today; the progress state doesn't track per-day history.
  // For MVP this is sufficient — shows today's completion status.

  const xpText = next
    ? `${(progress.totalXp - current.xpRequired).toLocaleString()} / ${(next.xpRequired - current.xpRequired).toLocaleString()} XP`
    : 'MAX LEVEL'

  const xpToNext = next ? (next.xpRequired - progress.totalXp).toLocaleString() : '0'

  return (
    <div style={{
      background: '#1A1A1A',
      height: 'calc(100vh - 72px)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
    }}>
      <div style={{
        maxWidth: 390,
        margin: '0 auto',
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column' as const,
        padding: '12px 16px 8px',
        gap: 10,
      }}>

        {/* Header: avatar + title + streak */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar — clickable with edit hint */}
            <button
              onClick={onOpenAvatarPicker}
              aria-label="Customize avatar"
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${progress.avatar.color}, ${progress.avatar.color}88)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                border: '2px solid rgba(56,200,255,0.4)',
                cursor: 'pointer',
                padding: 0,
                position: 'relative' as const,
              }}
            >
              {progress.avatar.icon}
              {/* Edit pencil badge */}
              <div style={{
                position: 'absolute' as const,
                bottom: -3,
                right: -3,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#38C8FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                border: '2px solid #1A1A1A',
              }}>
                ✏️
              </div>
            </button>
            <div>
              <div style={{ color: '#EEE4CE', fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
                PadelGenius
              </div>
              <div style={{ color: '#38C8FF', fontSize: 11, fontWeight: 600 }}>
                Lv.{current.level} {current.title} · {progress.totalXp.toLocaleString()} XP
              </div>
            </div>
          </div>
          {/* Streak badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: progress.streak > 0 ? 'rgba(255,70,85,0.1)' : '#262626',
            padding: '5px 10px',
            borderRadius: 16,
            border: progress.streak > 0 ? '1px solid rgba(255,70,85,0.2)' : '1px solid #333',
          }}>
            <span style={{ fontSize: 14 }}>🔥</span>
            <span style={{ color: '#FF4655', fontSize: 14, fontWeight: 800 }}>
              {progress.streak}
            </span>
          </div>
        </div>

        {/* XP progress bar (compact, no card wrapper) */}
        <div>
          <div style={{
            height: 4,
            background: '#333',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(xpProgress * 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #38C8FF, #7ED321)',
              borderRadius: 2,
              transition: 'width 700ms cubic-bezier(0.25, 0.1, 0.25, 1)',
            }} />
          </div>
          {next && (
            <div style={{ color: '#4A6F8E', fontSize: 10, marginTop: 3, textAlign: 'right' as const }}>
              {(next.xpRequired - progress.totalXp).toLocaleString()} XP to Lv.{next.level}
            </div>
          )}
        </div>

        {/* Today's theme card (compact) */}
        <div style={{
          padding: '14px 16px',
          background: 'linear-gradient(135deg, #1B4D3E 0%, #0d2e25 100%)',
          borderRadius: 14,
          border: '1px solid rgba(126,211,33,0.2)',
          position: 'relative' as const,
          overflow: 'hidden',
          flex: '0 0 auto',
        }}>
          <div style={{
            position: 'absolute' as const, top: -20, right: -20,
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(126,211,33,0.05)',
          }} />
          <div style={{ position: 'relative' as const }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{theme.emoji}</span>
              <span style={{
                color: '#7ED321', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase' as const, letterSpacing: 1,
              }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long' })}
              </span>
            </div>
            <div style={{ color: '#EEE4CE', fontSize: 20, fontWeight: 800, marginBottom: 2 }}>
              {theme.name}
            </div>
            <div style={{ color: '#9AAEC4', fontSize: 12, lineHeight: 1.3 }}>
              {theme.description}
            </div>
          </div>
        </div>

        {/* CTA Button */}
        {todayCompleted ? (
          <div style={{
            padding: 12,
            background: '#262626',
            borderRadius: 12,
            textAlign: 'center' as const,
            opacity: 0.7,
          }}>
            <div style={{ color: '#7ED321', fontSize: 15, fontWeight: 800 }}>
              Challenge Completed ✓
            </div>
            <div style={{ color: '#6889A5', fontSize: 11, marginTop: 1 }}>
              Come back tomorrow for more
            </div>
          </div>
        ) : (
          <button
            onClick={onStart}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'linear-gradient(135deg, #38C8FF, #2ba8d9)',
              borderRadius: 12,
              textAlign: 'center' as const,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(56,200,255,0.3)',
              border: 'none',
            }}
          >
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 800 }}>
              Start Today&#39;s Challenge
            </div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 }}>
              5 questions · ~3 min
            </div>
          </button>
        )}

        {/* Stats row */}
        <div style={{
          display: 'flex',
          gap: 8,
          textAlign: 'center' as const,
        }}>
          <div style={{ flex: 1, padding: '10px 6px', background: '#262626', borderRadius: 10 }}>
            <div style={{ color: '#EEE4CE', fontSize: 18, fontWeight: 800 }}>
              {progress.answeredAll.length}
            </div>
            <div style={{ color: '#6889A5', fontSize: 10 }}>Questions</div>
          </div>
          <div style={{ flex: 1, padding: '10px 6px', background: '#262626', borderRadius: 10 }}>
            <div style={{ color: '#7ED321', fontSize: 18, fontWeight: 800 }}>
              {accuracy}%
            </div>
            <div style={{ color: '#6889A5', fontSize: 10 }}>Accuracy</div>
          </div>
          <div style={{ flex: 1, padding: '10px 6px', background: '#262626', borderRadius: 10 }}>
            <div style={{ color: '#FF4655', fontSize: 18, fontWeight: 800 }}>
              {progress.bestStreak}
            </div>
            <div style={{ color: '#6889A5', fontSize: 10 }}>Best Streak</div>
          </div>
        </div>

        {/* WeekStrip — pushed to bottom */}
        <div style={{ marginTop: 'auto' }}>
          <WeekStrip completedDays={completedDays} />
        </div>

      </div>
    </div>
  )
}
