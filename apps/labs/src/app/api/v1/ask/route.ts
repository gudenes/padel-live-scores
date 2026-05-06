// apps/labs/src/app/api/v1/ask/route.ts
// Phase 1: stub. Phase 2 will replace this with Haiku 4.5 + tool use.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }

  return NextResponse.json({
    answer: `[Phase 1 stub] You asked: "${question}". The real chat engine ships in Phase 2 with Haiku 4.5 + grounded tool use.`,
    citations: [],
    cost: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
  })
}
