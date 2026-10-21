'use client'

import { useState, useCallback, useMemo } from 'react'
import { Link } from '@/i18n/navigation'
import { useGeniusProgress } from '@/hooks/useGeniusProgress'
import { getTodayTheme } from '@/data/genius-themes'
import { selectDailyQuestions } from '@/lib/genius-engine'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
import HubView from './components/HubView'
import QuestionView from './components/QuestionView'
import ExplanationView from './components/ExplanationView'
import SummaryView from './components/SummaryView'
import AvatarPicker from './components/AvatarPicker'
import questionsData from '@/data/genius-questions.json'

type View = 'hub' | 'playing' | 'explanation' | 'summary' | 'avatar'

interface SessionResult {
  question: GeniusQuestion
  result: AnswerResult
  userAnswer: string | { x: number; y: number }
}

export default function PadelGeniusPage() {
  const { progress, loaded, recordAnswer, completeDailyChallenge, updateAvatar, todayCompleted } = useGeniusProgress()

  const [view, setView] = useState<View>('hub')
  const [questions, setQuestions] = useState<GeniusQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([])
  const [lastResult, setLastResult] = useState<{ result: AnswerResult; userAnswer: string | { x: number; y: number } } | null>(null)

  const theme = useMemo(() => getTodayTheme(), [])

  // v1 hub reads from the v2-migrated JSON; field subset overlap is preserved at runtime,
  // so the structural mismatch is intentional. Double-cast keeps the v1 codepath compiling.
  const allQuestions = questionsData as unknown as GeniusQuestion[]

  const handleStart = useCallback(() => {
    const selected = selectDailyQuestions(
      allQuestions,
      theme.key,
      progress.currentDifficulty,
      progress.answeredAll,
      progress.wrongAnswers,
    )
    setQuestions(selected)
    setCurrentIndex(0)
    setSessionResults([])
    setLastResult(null)
    setView('playing')
  }, [allQuestions, theme.key, progress.currentDifficulty, progress.answeredAll, progress.wrongAnswers])

  const handleAnswer = useCallback((result: AnswerResult, userAnswer: string | { x: number; y: number }) => {
    const q = questions[currentIndex]
    recordAnswer(q.id, result.correct, result.xp)
    setSessionResults(prev => [...prev, { question: q, result, userAnswer }])
    setLastResult({ result, userAnswer })
    setView('explanation')
  }, [questions, currentIndex, recordAnswer])

  const handleNext = useCallback(() => {
    const nextIdx = currentIndex + 1
    if (nextIdx >= questions.length) {
      completeDailyChallenge()
      setView('summary')
    } else {
      setCurrentIndex(nextIdx)
      setLastResult(null)
      setView('playing')
    }
  }, [currentIndex, questions.length, completeDailyChallenge])

  const handleExit = useCallback(() => {
    setView('hub')
  }, [])

  if (!loaded) return null

  switch (view) {
    case 'hub':
      return (
        <>
          <Link
            href="/padelgenius/play"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              textAlign: 'center', background: '#22c55e', color: '#0a0a14',
              padding: '14px 20px', borderRadius: 16, fontWeight: 900, marginTop: 12, textDecoration: 'none',
            }}
          >
            <svg width={10} height={12} viewBox="0 0 10 12" aria-hidden="true">
              <path d="M 0 0 L 10 6 L 0 12 Z" fill="#0a0a14" />
            </svg>
            Play (new visuals)
          </Link>
          <HubView
            progress={progress}
            todayCompleted={todayCompleted}
            onStart={handleStart}
            onOpenAvatarPicker={() => setView('avatar')}
          />
        </>
      )

    case 'playing':
      return questions[currentIndex] ? (
        <QuestionView
          question={questions[currentIndex]}
          questionIndex={currentIndex}
          totalQuestions={questions.length}
          streak={progress.streak}
          avatarColor={progress.avatar.color}
          xpMultiplier={theme.xpMultiplier}
          onAnswer={handleAnswer}
          onExit={handleExit}
        />
      ) : null

    case 'explanation':
      return lastResult && questions[currentIndex] ? (
        <ExplanationView
          question={questions[currentIndex]}
          result={lastResult.result}
          userAnswer={lastResult.userAnswer}
          avatarColor={progress.avatar.color}
          xpMultiplier={theme.xpMultiplier}
          onNext={handleNext}
        />
      ) : null

    case 'summary':
      return (
        <SummaryView
          results={sessionResults}
          progress={progress}
          theme={theme}
          onReviewMistakes={() => setView('hub')}
          onBackToHub={() => setView('hub')}
        />
      )

    case 'avatar':
      return (
        <AvatarPicker
          currentAvatar={progress.avatar}
          level={progress.level}
          onSelect={(icon, color, name) => {
            updateAvatar(icon, color, name)
            setView('hub')
          }}
          onClose={() => setView('hub')}
        />
      )
  }
}
