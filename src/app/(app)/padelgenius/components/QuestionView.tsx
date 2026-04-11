'use client'

import React, { useState } from 'react'
import { scoreAnswer, scoreTapAnswer } from '@/lib/genius-engine'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
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

  const isTapMode = question.type === 'court-tap'

  const handleConfirm = () => {
    if (isTapMode) {
      if (!tapPoint) return
      const result = scoreTapAnswer(question, tapPoint.x, tapPoint.y, xpMultiplier)
      onAnswer(result, tapPoint)
    } else {
      if (!selectedOption) return
      const result = scoreAnswer(question, selectedOption, xpMultiplier)
      onAnswer(result, selectedOption)
    }
  }

  const canConfirm = isTapMode ? tapPoint !== null : selectedOption !== null

  return (
    <div style={{ background: '#111', minHeight: '100vh' }}>
      <div style={{ maxWidth: 390, margin: '0 auto', position: 'relative' as const }}>

        {/* Top bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
        }}>
          <button
            onClick={onExit}
            style={{
              background: 'none',
              border: 'none',
              color: '#6889A5',
              fontSize: 13,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            &#10005; Exit
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
            <span style={{ fontSize: 13 }}>&#x1F525;</span>
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
            <p style={{ color: '#38C8FF', fontSize: 14, margin: 0, fontWeight: 600 }}>
              &#x1F446; Tap where you should stand
            </p>
          </div>
        )}

        {/* Court */}
        <div style={{ padding: '0 12px' }}>
          <CourtView
            court={question.court}
            avatarColor={avatarColor}
            tapMode={isTapMode}
            onTap={(x, y) => setTapPoint({ x, y })}
            tapPoint={tapPoint}
          />
        </div>

        {/* Question panel for court-scenario / rules-card */}
        {!isTapMode && (
          <div style={{
            background: 'linear-gradient(180deg, rgba(26,26,26,0) 0%, #1A1A1A 15%)',
            padding: '20px 16px 16px',
            marginTop: -20,
            position: 'relative' as const,
          }}>
            {/* Question text */}
            <div style={{ textAlign: 'center' as const, marginBottom: 14 }}>
              <p style={{
                color: '#EEE4CE',
                fontSize: 16,
                fontWeight: 700,
                margin: '0 0 4px',
                lineHeight: 1.3,
              }}>
                {question.question}
              </p>
              {question.context && (
                <p style={{ color: '#9AAEC4', fontSize: 13, margin: 0 }}>
                  {question.context}
                </p>
              )}
            </div>

            {/* Answer options */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {question.options?.map((opt, i) => {
                const letter = String.fromCharCode(65 + i) // A, B, C
                const isSelected = selectedOption === opt.id

                return (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedOption(opt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 14px',
                      background: '#1F1F1F',
                      borderRadius: 12,
                      border: isSelected
                        ? '2px solid #38C8FF'
                        : '2px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left' as const,
                      boxShadow: isSelected
                        ? '0 0 12px rgba(56,200,255,0.1)'
                        : 'none',
                    }}
                  >
                    <div style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: '#38C8FF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      color: '#fff',
                      fontSize: 13,
                      flexShrink: 0,
                    }}>
                      {letter}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#EEE4CE', fontWeight: 600, fontSize: 14 }}>
                        {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
                      </div>
                      {opt.description && (
                        <div style={{ color: '#6889A5', fontSize: 11 }}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <div style={{ marginLeft: 'auto', color: '#38C8FF', fontSize: 16 }}>
                        &#10003;
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Tap mode hint */}
        {isTapMode && !tapPoint && (
          <div style={{ padding: '12px 16px', textAlign: 'center' as const }}>
            <p style={{ color: '#6889A5', fontSize: 12, margin: 0 }}>
              Tap anywhere on the court to place yourself
            </p>
          </div>
        )}

        {/* Confirm button */}
        <div style={{ padding: '12px 16px 20px' }}>
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
        </div>

      </div>
    </div>
  )
}
