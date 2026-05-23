// apps/ops/src/app/api/internal/docs/[slug]/route.ts
// GET + PUT for /api/internal/docs/[slug] — small key-value store for
// operator-editable reference docs (coverage capability matrix in v1).
//
// Auth: Auth.js session with isOperator flag (rule 1 — drop ops-auth cookie).
// Supabase: serviceClient() helper (rule 2). No @/auth dynamic import needed
// (rule 4 — this app owns its auth, no vitest conflict).
// Ported from src/app/api/ops/docs/[slug]/route.ts (Plan 3b-extra Task 2).

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const MAX_CONTENT_LEN = 200_000

type PutInput = { content: string }

type ValidationResult =
  | { ok: true; value: PutInput }
  | { ok: false; reason: string }

export function validatePutInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>
  if (typeof b.content !== 'string') {
    return { ok: false, reason: 'content must be a string' }
  }
  if (b.content.length > MAX_CONTENT_LEN) {
    return { ok: false, reason: `content exceeds max length of ${MAX_CONTENT_LEN}` }
  }
  return { ok: true, value: { content: b.content } }
}

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return Response.json({ error: 'invalid slug' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('ops_docs')
    .select('slug, content, updated_at, updated_by')
    .eq('slug', slug)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ doc: null }, { status: 200 })

  return Response.json({ doc: data as DocRow })
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return Response.json({ error: 'invalid slug' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const v = validatePutInput(body)
  if (!v.ok) return Response.json({ error: v.reason }, { status: 400 })

  const updatedBy = session.user?.email ?? null

  const supabase = serviceClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('ops_docs')
    .upsert(
      {
        slug,
        content: v.value.content,
        updated_at: nowIso,
        updated_by: updatedBy,
      },
      { onConflict: 'slug' },
    )
    .select('slug, content, updated_at, updated_by')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ doc: data as DocRow })
}
