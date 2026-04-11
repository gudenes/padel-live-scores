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
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <div style={{ maxWidth: 390, margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          padding: '20px 20px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Avatar */}
            <button
              onClick={onOpenAvatarPicker}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${progress.avatar.color}, ${progress.avatar.color}88)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                border: '2px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {progress.avatar.icon}
            </button>
            <div>
              <div style={{ color: '#EEE4CE', fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
                PadelGenius
              </div>
              <div style={{ color: '#6889A5', fontSize: 12, marginTop: 2 }}>
                Learn padel, one play at a time
              </div>
            </div>
          </div>
          {/* Streak badge */}
          {progress.streak > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#262626',
              padding: '6px 12px',
              borderRadius: 20,
            }}>
              <span style={{ fontSize: 16 }}>&#x1F525;</span>
              <span style={{ color: '#FF4655', fontSize: 16, fontWeight: 800 }}>
                {progress.streak}
              </span>
            </div>
          )}
        </div>

        {/* Level progress card */}
        <div style={{
          margin: 20,
          padding: 16,
          background: '#262626',
          borderRadius: 16,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${progress.avatar.color}, ${progress.avatar.color}88)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}>
                {progress.avatar.icon}
              </div>
              <div>
                <div style={{ color: '#EEE4CE', fontSize: 14, fontWeight: 700 }}>
                  Level {current.level} &mdash; {current.title}
                </div>
                <div style={{ color: '#6889A5', fontSize: 11 }}>
                  {xpText}
                </div>
              </div>
            </div>
          </div>
          {/* XP bar */}
          <div style={{
            height: 6,
            background: '#333',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(xpProgress * 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #38C8FF, #7ED321)',
              borderRadius: 3,
            }} />
          </div>
        </div>

        {/* Today's theme card */}
        <div style={{
          margin: '0 20px',
          padding: 20,
          background: 'linear-gradient(135deg, #1B4D3E 0%, #0d2e25 100%)',
          borderRadius: 16,
          border: '1px solid rgba(126,211,33,0.2)',
          position: 'relative' as const,
          overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          <div style={{
            position: 'absolute' as const,
            top: -20,
            right: -20,
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'rgba(126,211,33,0.05)',
          }} />
          <div style={{
            position: 'absolute' as const,
            bottom: -30,
            left: -10,
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(56,200,255,0.05)',
          }} />

          <div style={{ position: 'relative' as const }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{theme.emoji}</span>
              <span style={{
                color: '#7ED321',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: 1,
              }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long' })}
              </span>
            </div>
            <div style={{ color: '#EEE4CE', fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
              {theme.name}
            </div>
            <div style={{ color: '#9AAEC4', fontSize: 13, lineHeight: 1.4 }}>
              {theme.description}
            </div>

            {/* Mode badges */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <div style={{
                padding: '4px 10px',
                background: 'rgba(56,200,255,0.15)',
                borderRadius: 8,
                color: '#38C8FF',
                fontSize: 11,
                fontWeight: 600,
              }}>
                3x Court Scenario
              </div>
              <div style={{
                padding: '4px 10px',
                background: 'rgba(244,114,182,0.15)',
                borderRadius: 8,
                color: '#F472B6',
                fontSize: 11,
                fontWeight: 600,
              }}>
                2x Court Tap
              </div>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <div style={{ margin: 20 }}>
          {todayCompleted ? (
            <div style={{
              padding: 16,
              background: '#262626',
              borderRadius: 14,
              textAlign: 'center' as const,
              opacity: 0.7,
            }}>
              <div style={{ color: '#7ED321', fontSize: 17, fontWeight: 800 }}>
                Challenge Completed &#10003;
              </div>
              <div style={{ color: '#6889A5', fontSize: 12, marginTop: 2 }}>
                Come back tomorrow for more
              </div>
            </div>
          ) : (
            <button
              onClick={onStart}
              style={{
                width: '100%',
                padding: 16,
                background: 'linear-gradient(135deg, #38C8FF, #2ba8d9)',
                borderRadius: 14,
                textAlign: 'center' as const,
                cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(56,200,255,0.3)',
                border: 'none',
              }}
            >
              <div style={{ color: '#fff', fontSize: 17, fontWeight: 800 }}>
                Start Today&#39;s Challenge
              </div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
                5 questions &middot; ~3 min
              </div>
            </button>
          )}
        </div>

        {/* Stats row */}
        <div style={{
          display: 'flex',
          gap: 12,
          margin: '0 20px 20px',
          textAlign: 'center' as const,
        }}>
          <div style={{ flex: 1, padding: '14px 8px', background: '#262626', borderRadius: 12 }}>
            <div style={{ color: '#EEE4CE', fontSize: 20, fontWeight: 800 }}>
              {progress.answeredAll.length}
            </div>
            <div style={{ color: '#6889A5', fontSize: 11 }}>Questions</div>
          </div>
          <div style={{ flex: 1, padding: '14px 8px', background: '#262626', borderRadius: 12 }}>
            <div style={{ color: '#7ED321', fontSize: 20, fontWeight: 800 }}>
              {accuracy}%
            </div>
            <div style={{ color: '#6889A5', fontSize: 11 }}>Accuracy</div>
          </div>
          <div style={{ flex: 1, padding: '14px 8px', background: '#262626', borderRadius: 12 }}>
            <div style={{ color: '#FF4655', fontSize: 20, fontWeight: 800 }}>
              {progress.bestStreak}
            </div>
            <div style={{ color: '#6889A5', fontSize: 11 }}>Best Streak</div>
          </div>
        </div>

        {/* WeekStrip */}
        <div style={{ margin: '0 20px 24px' }}>
          <WeekStrip completedDays={completedDays} />
        </div>

      </div>
    </div>
  )
}
