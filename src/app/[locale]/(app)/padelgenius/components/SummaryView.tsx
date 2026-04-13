'use client'

import React from 'react'
import { useFormatter } from 'next-intl'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
import type { GeniusProgressState } from '@/hooks/useGeniusProgress'
import type { DailyTheme } from '@/data/genius-themes'
import { getThemeForDay } from '@/data/genius-themes'
import { getXpProgress } from '@/data/genius-levels'

interface SummaryViewProps {
  results: { question: GeniusQuestion; result: AnswerResult }[]
  progress: GeniusProgressState
  theme: DailyTheme
  onReviewMistakes: () => void
  onBackToHub: () => void
}

export default function SummaryView({
  results,
  progress,
  theme,
  onReviewMistakes,
  onBackToHub,
}: SummaryViewProps) {
  const format = useFormatter()
  const correctCount = results.filter(r => r.result.correct).length
  const totalXpEarned = results.reduce((sum, r) => sum + r.result.xp, 0)
  const hasMistakes = results.some(r => !r.result.correct)

  const { current, next, progress: xpProgress } = getXpProgress(progress.totalXp)
  const xpToNext = next ? next.xpRequired - progress.totalXp : 0

  // Tomorrow's theme
  const tomorrowDayOfWeek = (new Date().getDay() + 1) % 7
  const tomorrowTheme = getThemeForDay(tomorrowDayOfWeek)

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <div style={{ maxWidth: 390, margin: '0 auto', padding: '24px 20px' }}>

        {/* Celebration header */}
        <div style={{ textAlign: 'center' as const, marginBottom: 24 }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>&#x1F3C6;</div>
          <div style={{ color: '#EEE4CE', fontSize: 28, fontWeight: 800 }}>
            Challenge Complete!
          </div>
          <div style={{ color: '#9AAEC4', fontSize: 14, marginTop: 4 }}>
            {theme.name} {format.dateTime(new Date(), { weekday: 'long' })}
          </div>
        </div>

        {/* Score card */}
        <div style={{
          background: '#262626',
          borderRadius: 16,
          padding: 20,
          marginBottom: 16,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-around',
            textAlign: 'center' as const,
          }}>
            <div>
              <div style={{ color: '#7ED321', fontSize: 32, fontWeight: 800 }}>
                {correctCount}/{results.length}
              </div>
              <div style={{ color: '#6889A5', fontSize: 12 }}>Correct</div>
            </div>
            <div style={{ width: 1, background: '#333' }} />
            <div>
              <div style={{ color: '#38C8FF', fontSize: 32, fontWeight: 800 }}>
                +{totalXpEarned}
              </div>
              <div style={{ color: '#6889A5', fontSize: 12 }}>XP Earned</div>
            </div>
            <div style={{ width: 1, background: '#333' }} />
            <div>
              <div style={{ color: '#FF4655', fontSize: 32, fontWeight: 800 }}>
                {progress.streak} &#x1F525;
              </div>
              <div style={{ color: '#6889A5', fontSize: 12 }}>Day Streak</div>
            </div>
          </div>
        </div>

        {/* Level progress card */}
        <div style={{
          background: '#262626',
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <div style={{ color: '#EEE4CE', fontSize: 14, fontWeight: 600 }}>
              Level {current.level} &mdash; {current.title}
            </div>
            <div style={{ color: '#38C8FF', fontSize: 13, fontWeight: 600 }}>
              {next
                ? `${(progress.totalXp - current.xpRequired).toLocaleString()} / ${(next.xpRequired - current.xpRequired).toLocaleString()} XP`
                : 'MAX'}
            </div>
          </div>
          <div style={{
            height: 8,
            background: '#333',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(xpProgress * 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #38C8FF, #7ED321)',
              borderRadius: 4,
            }} />
          </div>
          {next && (
            <div style={{ color: '#6889A5', fontSize: 11, marginTop: 6 }}>
              {xpToNext.toLocaleString()} XP to Level {next.level} &mdash; {next.title}
            </div>
          )}
        </div>

        {/* Question breakdown */}
        <div style={{
          background: '#262626',
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{
            color: '#6889A5',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: 0.5,
            marginBottom: 10,
          }}>
            Question Breakdown
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {results.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  color: r.result.correct ? '#7ED321' : '#FF4655',
                  fontSize: 16,
                }}>
                  {r.result.correct ? '\u2713' : '\u2715'}
                </div>
                <div style={{
                  color: r.result.correct ? '#EEE4CE' : '#9AAEC4',
                  fontSize: 13,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' as const,
                }}>
                  {r.question.question.length > 40
                    ? r.question.question.slice(0, 40) + '...'
                    : r.question.question}
                </div>
                <div style={{
                  color: r.result.correct ? '#7ED321' : '#FF4655',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  +{r.result.xp}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          {hasMistakes && (
            <button
              onClick={onReviewMistakes}
              style={{
                flex: 1,
                padding: 14,
                background: '#262626',
                borderRadius: 12,
                textAlign: 'center' as const,
                cursor: 'pointer',
                border: '1px solid #333',
              }}
            >
              <div style={{ color: '#EEE4CE', fontWeight: 600, fontSize: 14 }}>
                Review Mistakes
              </div>
            </button>
          )}
          <button
            onClick={onBackToHub}
            style={{
              flex: 1,
              padding: 14,
              background: '#38C8FF',
              borderRadius: 12,
              textAlign: 'center' as const,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            <div style={{ color: '#1A1A1A', fontWeight: 800, fontSize: 14 }}>
              Back to Hub
            </div>
          </button>
        </div>

        {/* Tomorrow teaser */}
        <div style={{
          marginTop: 16,
          padding: 14,
          background: 'linear-gradient(135deg, rgba(56,200,255,0.08), rgba(244,114,182,0.08))',
          borderRadius: 12,
          textAlign: 'center' as const,
          border: '1px solid rgba(56,200,255,0.1)',
        }}>
          <div style={{
            color: '#6889A5',
            fontSize: 11,
            textTransform: 'uppercase' as const,
            letterSpacing: 0.5,
          }}>
            Tomorrow
          </div>
          <div style={{ color: '#EEE4CE', fontSize: 15, fontWeight: 700, marginTop: 2 }}>
            {tomorrowTheme.emoji} {tomorrowTheme.name}
          </div>
          <div style={{ color: '#9AAEC4', fontSize: 12, marginTop: 2 }}>
            Come back to keep your streak alive!
          </div>
        </div>

      </div>
    </div>
  )
}
