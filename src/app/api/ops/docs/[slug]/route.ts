import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

// GET + PUT for /api/ops/docs/[slug] — small key-value store for
// operator-editable reference docs (coverage capability matrix in v1).
//
// Auth: ops_token cookie via checkOpsAuth (same pattern as every other
// /api/ops/* route). Underlying writes use the service-role key, bypassing
// RLS — RLS is defence-in-depth, not the primary access gate.

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

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
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
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { slug } = await params
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return Response.json({ error: 'invalid slug' }, { status: 400 })
  }

  const supabase = getSupabase()
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
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

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

  // Opportunistic: stamp updated_by with the operator's Auth.js session
  // email when one is present. Many ops requests are made cookie-only
  // (no full Auth.js session) — in that case we leave updated_by as null.
  //
  // The dynamic `await import('@/auth')` is deliberate, NOT a candidate
  // for "fix to top-level import." A top-level import here triggers a
  // vitest-only module-resolution failure inside next-auth/lib/env.js
  // ("Cannot find module .../next/server"). Other routes that
  // import @/auth at the top level (match-rating, leaderboard, etc.)
  // get away with it because they have no co-located vitest tests —
  // this one does, so we defer the load to runtime. The cost is one
  // cached module lookup per PUT call, which Node will memoize anyway.
  let updatedBy: string | null = null
  try {
    const { auth } = await import('@/auth')
    const session = await auth()
    updatedBy = session?.user?.email ?? null
  } catch {
    // No session — fine, leave null.
  }

  const supabase = getSupabase()
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
