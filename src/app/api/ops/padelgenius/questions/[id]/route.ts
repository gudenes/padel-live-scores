// src/app/api/ops/padelgenius/questions/[id]/route.ts
import { NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { loadQuestion, saveQuestion, deleteQuestion } from '@/lib/padelgenius/question-store'
import { validateQuestion } from '@/lib/padelgenius/question-validation'
import type { Question } from '@/lib/padelgenius/types'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { id } = await params
  const q = await loadQuestion(parseInt(id, 10))
  if (!q) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ question: q })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { id } = await params
  const body = await req.json() as Question
  if (body.id !== parseInt(id, 10)) return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  const v = validateQuestion(body)
  if (!v.ok) return NextResponse.json({ error: 'invalid', validation: v }, { status: 400 })
  await saveQuestion(body)
  return NextResponse.json({ ok: true, validation: v })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { id } = await params
  await deleteQuestion(parseInt(id, 10))
  return NextResponse.json({ ok: true })
}
