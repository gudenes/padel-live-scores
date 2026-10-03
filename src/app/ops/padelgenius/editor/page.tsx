// src/app/ops/padelgenius/editor/page.tsx
import { loadAllQuestions } from '@/lib/padelgenius/question-store'
import { loadActiveCourt } from '@/lib/padelgenius/court-loader'
import { Editor } from './Editor'

export const dynamic = 'force-dynamic'

export default async function EditorPage() {
  const [questions, { config: court }] = await Promise.all([
    loadAllQuestions(),
    loadActiveCourt(),
  ])
  return <Editor initialQuestions={questions} court={court} />
}
