// src/app/[locale]/(app)/padelgenius/play/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import questionsData from '@/data/genius-questions.json'
import type { Question, OptionId } from '@/lib/padelgenius/types'
import { PlayMode } from '../components/PlayMode'
import { LessonSummary } from '../components/LessonSummary'
import '../padelgenius.css'

const LESSON_SIZE = 5

function pickLesson(all: Question[]): Question[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, LESSON_SIZE)
}

export default function PadelGeniusPlayPage() {
  const router = useRouter()
  const [lesson, setLesson] = useState<Question[]>(() => pickLesson(questionsData as Question[]))
  const [results, setResults] = useState<{ questionId: number; picked: OptionId | null; correct: boolean }[] | null>(null)

  const handleExit = () => router.push('/padelgenius')
  const handleComplete = (r: typeof results) => setResults(r)
  const handlePlayAgain = () => {
    setLesson(pickLesson(questionsData as Question[]))
    setResults(null)
  }

  if (results) {
    return <LessonSummary questions={lesson} results={results} onPlayAgain={handlePlayAgain} onExit={handleExit} />
  }
  return <PlayMode questions={lesson} onExit={handleExit} onComplete={handleComplete} />
}
