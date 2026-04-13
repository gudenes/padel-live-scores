'use client'

import React from 'react'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
import CourtView from './CourtView'

interface ExplanationViewProps {
  question: GeniusQuestion
  result: AnswerResult
  userAnswer: string | { x: number; y: number }
  avatarColor: string
  xpMultiplier: number
  onNext: () => void
}

export default function ExplanationView({
  question,
  result,
  userAnswer,
  avatarColor,
  onNext,
}: ExplanationViewProps) {
  const isCorrect = result.correct

  // Find labels for user answer vs correct answer (for wrong MCQ answers)
  let userAnswerLabel: string | undefined
  let correctAnswerLabel: string | undefined
  if (!isCorrect && typeof userAnswer === 'string' && question.options) {
    const userOpt = question.options.find(o => o.id === userAnswer)
    const correctOpt = question.options.find(o => o.id === question.correctOption)
    userAnswerLabel = userOpt?.label
    correctAnswerLabel = correctOpt?.label
  }

  // Build tap point for court-tap questions
  const tapPoint = typeof userAnswer === 'object' && 'x' in userAnswer ? userAnswer : null

  return (
    <div style={{ background: '#111', minHeight: '100vh' }}>
      <div style={{ maxWidth: 390, margin: '0 auto' }}>

        {/* Result banner */}
        <div style={{
          padding: 20,
          textAlign: 'center' as const,
          background: isCorrect
            ? 'linear-gradient(180deg, rgba(126,211,33,0.12) 0%, transparent 100%)'
            : 'linear-gradient(180deg, rgba(255,70,85,0.1) 0%, transparent 100%)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 4 }}>
            {isCorrect ? '\uD83C\uDFAF' : '\uD83D\uDE24'}
          </div>
          <div style={{
            color: isCorrect ? '#7ED321' : '#FF4655',
            fontSize: 26,
            fontWeight: 800,
          }}>
            {isCorrect ? 'Correct!' : 'Not quite!'}
          </div>
          {isCorrect && result.xp > 0 && (
            <div style={{
              display: 'inline-block',
              marginTop: 6,
              padding: '4px 14px',
              background: 'rgba(126,211,33,0.15)',
              borderRadius: 20,
            }}>
              <span style={{ color: '#7ED321', fontSize: 14, fontWeight: 700 }}>
                +{result.xp} XP
              </span>
            </div>
          )}
          {!isCorrect && result.xp > 0 && (
            <div style={{
              display: 'inline-block',
              marginTop: 6,
              padding: '4px 14px',
              background: 'rgba(56,200,255,0.15)',
              borderRadius: 20,
            }}>
              <span style={{ color: '#38C8FF', fontSize: 14, fontWeight: 700 }}>
                +{result.xp} XP (partial)
              </span>
            </div>
          )}
          {!isCorrect && result.xp === 0 && (
            <div style={{ color: '#6889A5', fontSize: 13, marginTop: 4 }}>
              Don&#39;t worry &mdash; this is how you learn
            </div>
          )}
        </div>

        {/* Court with overlay */}
        <div style={{ padding: '0 16px' }}>
          <CourtView
            court={question.court}
            avatarColor={avatarColor}
            overlay={question.explanation.courtOverlay}
            tapPoint={tapPoint}
            correctZone={question.type === 'court-tap' ? question.correctZone : undefined}
          />
        </div>

        {/* Wrong answer comparison (MCQ only) */}
        {!isCorrect && userAnswerLabel && correctAnswerLabel && (
          <div style={{ padding: '0 20px' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <div style={{
                flex: 1,
                padding: 12,
                background: 'rgba(255,70,85,0.08)',
                borderRadius: 10,
                border: '1px solid rgba(255,70,85,0.3)',
              }}>
                <div style={{
                  color: '#FF4655',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                }}>
                  Your Answer
                </div>
                <div style={{ color: '#EEE4CE', fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  {userAnswerLabel}
                </div>
              </div>
              <div style={{
                flex: 1,
                padding: 12,
                background: 'rgba(126,211,33,0.08)',
                borderRadius: 10,
                border: '1px solid rgba(126,211,33,0.3)',
              }}>
                <div style={{
                  color: '#7ED321',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                }}>
                  Correct
                </div>
                <div style={{ color: '#EEE4CE', fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  {correctAnswerLabel}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Explanation card */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{
            background: '#1F1F1F',
            borderRadius: 14,
            padding: 16,
            borderLeft: `3px solid ${isCorrect ? '#38C8FF' : '#FF4655'}`,
          }}>
            <div style={{
              color: isCorrect ? '#38C8FF' : '#FF4655',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: 0.8,
              marginBottom: 8,
            }}>
              {question.explanation.title}
            </div>
            <p style={{
              color: '#EEE4CE',
              fontSize: 14,
              lineHeight: 1.6,
              margin: 0,
            }}>
              {question.explanation.text}
            </p>

            {/* Pro Tip */}
            {question.explanation.proTip && (
              <div style={{
                marginTop: 12,
                padding: 10,
                background: 'rgba(126,211,33,0.08)',
                borderRadius: 8,
              }}>
                <div style={{ color: '#7ED321', fontSize: 12, fontWeight: 600 }}>
                  &#x1F4A1; Pro Tip
                </div>
                <div style={{ color: '#9AAEC4', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
                  {question.explanation.proTip}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sponsor slot (structural markup, empty for now) */}
        <div style={{ padding: '0 20px 4px', textAlign: 'center' as const }}>
          {/* Powered by SPONSOR — placeholder for future sponsorship */}
        </div>

        {/* Next button */}
        <div style={{ padding: '0 20px 20px' }}>
          <button
            onClick={onNext}
            style={{
              width: '100%',
              padding: 14,
              background: '#38C8FF',
              borderRadius: 12,
              textAlign: 'center' as const,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            <span style={{ color: '#1A1A1A', fontWeight: 800, fontSize: 15 }}>
              Next Question &rarr;
            </span>
          </button>
        </div>

      </div>
    </div>
  )
}
