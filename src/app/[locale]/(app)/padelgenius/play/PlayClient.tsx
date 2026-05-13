// src/app/[locale]/(app)/padelgenius/play/PlayClient.tsx
'use client'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import type { Question, OptionId } from '@/lib/padelgenius/types'
import { PlayMode } from '../components/PlayMode'
import { LessonSummary } from '../components/LessonSummary'

const LESSON_SIZE = 5

function pickLesson(all: Question[]): Question[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, LESSON_SIZE)
}

export function PlayClient({ questions }: { questions: Question[] }) {
  const router = useRouter()
  const [lesson, setLesson] = useState<Question[]>(() => pickLesson(questions))
  const [results, setResults] = useState<{ questionId: number; picked: OptionId | null; correct: boolean }[] | null>(null)

  const handleExit = () => router.push('/padelgenius')
  const handleComplete = (r: typeof results) => setResults(r)
  const handlePlayAgain = () => { setLesson(pickLesson(questions)); setResults(null) }

  return results
    ? <LessonSummary questions={lesson} results={results} onPlayAgain={handlePlayAgain} onExit={handleExit} />
    : <PlayMode questions={lesson} onExit={handleExit} onComplete={handleComplete} />
}
