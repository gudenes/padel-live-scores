// src/app/api/ops/padelgenius/questions/route.ts
import { NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { loadAllQuestions, createQuestion } from '@/lib/padelgenius/question-store'

export async function GET() {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const questions = await loadAllQuestions()
  return NextResponse.json({ questions })
}

export async function POST() {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const q = await createQuestion()
  return NextResponse.json({ question: q })
}
