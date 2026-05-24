// apps/ops/src/app/api/internal/ocr-diff-label/route.ts
//
// POST /api/internal/ocr-diff-label
//
// Operator labeling endpoint for the OCR Health tab's "OCR was right /
// wrong" buttons. Writes a one-line attribution string into
// padelgod.ocr_diff_events.notes including the labeling operator's email
// (sourced from the Auth.js session, not the request body).
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient().

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_LABELS = new Set(['correct', 'incorrect'])

interface RequestBody {
  diffId?: number
  label?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as RequestBody
  const { diffId, label } = body

  if (typeof diffId !== 'number' || !label || !ALLOWED_LABELS.has(label)) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 })
  }

  const operatorEmail = session.user.email ?? 'unknown'
  const note = `operator_label=${label} by=${operatorEmail} at=${new Date().toISOString()}`

  const supabase = serviceClient()
  const { data, error } = await supabase
    .schema('padelgod')
    .from('ocr_diff_events')
    .update({ notes: note })
    .eq('id', diffId)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'diff event not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
