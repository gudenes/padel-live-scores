'use client'

import React, { useState, useEffect, useRef } from 'react'
import { scoreAnswer, scoreTapAnswer } from '@/lib/genius-engine'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
import type { CourtOverlay } from './CourtView'
import CourtView from './CourtView'

interface QuestionViewProps {
  question: GeniusQuestion
  questionIndex: number
  totalQuestions: number
  streak: number
  avatarColor: string
  xpMultiplier: number
  onAnswer: (result: AnswerResult, userAnswer: string | { x: number; y: number }) => void
  onExit: () => void
}

export default function QuestionView({
  question,
  questionIndex,
  totalQuestions,
  streak,
  avatarColor,
  xpMultiplier,
  onAnswer,
  onExit,
}: QuestionViewProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null)

  // Animation state — brief play animation after confirm, before transitioning
  const [animating, setAnimating] = useState(false)
  const [animResult, setAnimResult] = useState<{
    result: AnswerResult
    userAnswer: string | { x: number; y: number }
    overlay: CourtOverlay | undefined
  } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const isTapMode = question.type === 'court-tap'

  const handleConfirm = () => {
    let result: AnswerResult
    let userAnswer: string | { x: number; y: number }

    if (isTapMode) {
      if (!tapPoint) return
      result = scoreTapAnswer(question, tapPoint.x, tapPoint.y, xpMultiplier)
      userAnswer = tapPoint
    } else {
      if (!selectedOption) return
      result = scoreAnswer(question, selectedOption, xpMultiplier)
      userAnswer = selectedOption
    }

    // Build overlay from explanation courtOverlay
    const overlay: CourtOverlay | undefined = question.explanation.courtOverlay
      ? {
          trajectory: question.explanation.courtOverlay.trajectory,
          wrongTrajectory: question.explanation.courtOverlay.wrongTrajectory,
          label: question.explanation.courtOverlay.label,
        }
      : undefined

    // Enter animation state
    setAnimating(true)
    setAnimResult({ result, userAnswer, overlay })

    // After 1.5s, transition to explanation
    timerRef.current = setTimeout(() => {
      onAnswer(result, userAnswer)
    }, 1500)
  }

  const canConfirm = !animating && (isTapMode ? tapPoint !== null : selectedOption !== null)

  // During animation: determine button state
  const animCorrect = animResult?.result.correct
  const animXp = animResult?.result.xp ?? 0

  return (
    <div style={{
      background: '#111',
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
        position: 'relative' as const,
      }}>

        {/* Top bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
        }}>
          <button
            onClick={onExit}
            disabled={animating}
            style={{
              background: 'none',
              border: 'none',
              color: '#6889A5',
              fontSize: 13,
              cursor: animating ? 'default' : 'pointer',
              padding: 0,
              opacity: animating ? 0.4 : 1,
            }}
          >
            ✕ Exit
          </button>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: totalQuestions }, (_, i) => {
              let bg = '#333'
              if (i < questionIndex) bg = '#7ED321'
              else if (i === questionIndex) bg = '#38C8FF'
              return (
                <div
                  key={i}
                  style={{
                    width: 24,
                    height: 4,
                    borderRadius: 2,
                    background: bg,
                    boxShadow: i === questionIndex ? '0 0 8px rgba(56,200,255,0.5)' : 'none',
                  }}
                />
              )
            })}
          </div>

          {/* Streak */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 13 }}>🔥</span>
            <span style={{ color: '#FF4655', fontSize: 13, fontWeight: 700 }}>
              {streak}
            </span>
          </div>
        </div>

        {/* Court Tap: question above court */}
        {isTapMode && (
          <div style={{ textAlign: 'center' as const, padding: '8px 16px 12px' }}>
            <p style={{
              color: '#EEE4CE',
              fontSize: 16,
              fontWeight: 700,
              margin: '0 0 4px',
              lineHeight: 1.3,
            }}>
              {question.question}
            </p>
            {!animating && (
              <p style={{ color: '#38C8FF', fontSize: 14, margin: 0, fontWeight: 600 }}>
                👆 Tap where you should stand
              </p>
            )}
          </div>
        )}

        {/* Court — fills remaining space */}
        <div style={{
          padding: '0 8px',
          flex: '1 1 0',
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          position: 'relative' as const,
        }}>
          <CourtView
            court={question.court}
            avatarColor={avatarColor}
            tapMode={isTapMode && !animating}
            onTap={(x, y) => setTapPoint({ x, y })}
            tapPoint={tapPoint}
            overlay={animating ? animResult?.overlay : undefined}
            correctZone={animating && isTapMode ? question.correctZone : undefined}
          />

          {/* Result flash overlay during animation */}
          {animating && (
            <div style={{
              position: 'absolute' as const,
              top: '35%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center' as const,
              zIndex: 50,
              animation: 'none',
            }}>
              <div style={{
                fontSize: 40,
                marginBottom: 4,
                filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
              }}>
                {animCorrect ? '🎯' : '😤'}
              </div>
              <div style={{
                fontSize: 24,
                fontWeight: 900,
                color: animCorrect ? '#7ED321' : '#FF4655',
                textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                letterSpacing: -0.5,
              }}>
                {animCorrect ? 'Correct!' : 'Wrong!'}
              </div>
              {animCorrect && animXp > 0 && (
                <div style={{
                  marginTop: 4,
                  display: 'inline-block',
                  padding: '3px 12px',
                  background: 'rgba(126,211,33,0.2)',
                  borderRadius: 12,
                  color: '#7ED321',
                  fontSize: 14,
                  fontWeight: 700,
                }}>
                  +{animXp} XP
                </div>
              )}
            </div>
          )}
        </div>

        {/* Question panel for court-scenario / rules-card */}
        {!isTapMode && (
          <div style={{
            padding: '8px 12px 0',
            flex: '0 0 auto',
            opacity: animating ? 0.4 : 1,
            pointerEvents: animating ? 'none' as const : 'auto' as const,
            transition: 'opacity 0.3s',
          }}>
            {/* Question text */}
            <div style={{ textAlign: 'center' as const, marginBottom: 8 }}>
              <p style={{
                color: '#EEE4CE',
                fontSize: 14,
                fontWeight: 700,
                margin: '0 0 2px',
                lineHeight: 1.3,
              }}>
                {question.question}
              </p>
              {question.context && (
                <p style={{ color: '#9AAEC4', fontSize: 11, margin: 0 }}>
                  {question.context}
                </p>
              )}
            </div>

            {/* Answer options — compact */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {question.options?.map((opt, i) => {
                const letter = String.fromCharCode(65 + i)
                const isSelected = selectedOption === opt.id
                // During animation: highlight correct/wrong
                const isCorrect = animating && opt.id === question.correctOption
                const isWrong = animating && isSelected && opt.id !== question.correctOption

                let borderColor = 'transparent'
                let bgColor = '#1F1F1F'
                if (isCorrect) { borderColor = '#7ED321'; bgColor = 'rgba(126,211,33,0.08)' }
                else if (isWrong) { borderColor = '#FF4655'; bgColor = 'rgba(255,70,85,0.08)' }
                else if (isSelected && !animating) { borderColor = '#38C8FF' }

                return (
                  <button
                    key={opt.id}
                    onClick={() => !animating && setSelectedOption(opt.id)}
                    disabled={animating}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: bgColor,
                      borderRadius: 10,
                      border: `2px solid ${borderColor}`,
                      cursor: animating ? 'default' : 'pointer',
                      textAlign: 'left' as const,
                      transition: 'all 0.3s',
                    }}
                  >
                    <div style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: isCorrect ? '#7ED321' : isWrong ? '#FF4655' : isSelected ? '#38C8FF' : '#333',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      color: '#fff',
                      fontSize: 12,
                      flexShrink: 0,
                      transition: 'background 0.3s',
                    }}>
                      {isCorrect ? '✓' : isWrong ? '✕' : letter}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#EEE4CE', fontWeight: 600, fontSize: 13 }}>
                        {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Tap mode hint */}
        {isTapMode && !tapPoint && !animating && (
          <div style={{ padding: '12px 16px', textAlign: 'center' as const }}>
            <p style={{ color: '#6889A5', fontSize: 12, margin: 0 }}>
              Tap anywhere on the court to place yourself
            </p>
          </div>
        )}

        {/* Confirm / Result button */}
        <div style={{ padding: '8px 12px 8px' }}>
          {animating ? (
            <div style={{
              width: '100%',
              padding: 14,
              background: animCorrect ? 'rgba(126,211,33,0.15)' : 'rgba(255,70,85,0.15)',
              borderRadius: 12,
              textAlign: 'center' as const,
              border: `1px solid ${animCorrect ? 'rgba(126,211,33,0.3)' : 'rgba(255,70,85,0.3)'}`,
              transition: 'all 0.3s',
            }}>
              <span style={{
                color: animCorrect ? '#7ED321' : '#FF4655',
                fontWeight: 800,
                fontSize: 15,
              }}>
                {animCorrect ? `Correct! +${animXp} XP` : 'Wrong!'}
              </span>
            </div>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              style={{
                width: '100%',
                padding: 14,
                background: canConfirm ? '#38C8FF' : '#333',
                borderRadius: 12,
                textAlign: 'center' as const,
                cursor: canConfirm ? 'pointer' : 'default',
                border: 'none',
                opacity: canConfirm ? 1 : 0.5,
              }}
            >
              <span style={{ color: canConfirm ? '#1A1A1A' : '#666', fontWeight: 800, fontSize: 15 }}>
                {isTapMode ? 'Confirm Position' : 'Confirm Answer'}
              </span>
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
