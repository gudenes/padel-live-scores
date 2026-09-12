// apps/ops/src/app/api/internal/team/[id]/route.ts
// Team read + narrow update for the ops team editor.
//
// There is no POST and no DELETE on purpose: teams come from the season
// import. A create button here would produce orphan teams with no season, no
// roster and no fixtures — objects the public page cannot render.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const PATCHABLE_FIELDS = new Set([
  'badge_label',
  'short_name',
  'city',
  'country',
  'cover_image_url',
  'crest_url',
])

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const { data, error } = await serviceClient()
    .from('teams')
    .select('id, slug, name, club, city, country, competition, category, badge_label, short_name, crest_url, cover_image_url')
    .eq('id', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Team not found' }, { status: 404 })
  return Response.json({ team: data })
}

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Expected JSON body' }, { status: 400 })
  }

  const unknownFields = Object.keys(body).filter(k => !PATCHABLE_FIELDS.has(k))
  if (unknownFields.length > 0) {
    return Response.json({ error: `Unknown fields: ${unknownFields.join(', ')}` }, { status: 400 })
  }
  if (Object.keys(body).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await serviceClient().from('teams').update(body).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
