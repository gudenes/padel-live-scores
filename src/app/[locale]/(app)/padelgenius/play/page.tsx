// src/app/[locale]/(app)/padelgenius/play/page.tsx
import { loadActiveCourt } from '@/lib/padelgenius/court-loader'
import { ActiveCourtProvider } from '../components/ActiveCourtProvider'
import { PlayClient } from './PlayClient'
import questionsData from '@/data/genius-questions.json'
import type { Question } from '@/lib/padelgenius/types'
import '../padelgenius.css'

export default async function PadelGeniusPlayPage() {
  const { config } = await loadActiveCourt()
  return (
    <ActiveCourtProvider court={config}>
      <PlayClient questions={questionsData as Question[]} />
    </ActiveCourtProvider>
  )
}
