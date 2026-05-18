import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { validateCoverFile } from '@/lib/tournament-cover-validation'
import {
  ensureTournamentCoversBucket,
  TOURNAMENT_COVERS_BUCKET,
} from '@/lib/tournament-cover-bucket'

export const runtime = 'nodejs'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id: tournamentId } = await ctx.params
  if (!tournamentId) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 })
  }
  const file = formData.get('file')
  const validation = validateCoverFile(file instanceof File ? file : null)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }
  const validFile = file as File

  const supabase = getSupabaseAdmin()

  const { data: tournament, error: lookupError } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (lookupError) {
    return NextResponse.json(
      { error: 'db_lookup_failed', detail: lookupError.message },
      { status: 500 },
    )
  }
  if (!tournament) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  await ensureTournamentCoversBucket(supabase)

  const objectKey = `${tournamentId}.${validation.ext}`
  const arrayBuffer = await validFile.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from(TOURNAMENT_COVERS_BUCKET)
    .upload(objectKey, arrayBuffer, {
      contentType: validFile.type,
      upsert: true,
    })
  if (uploadError) {
    return NextResponse.json(
      { error: 'upload_failed', detail: uploadError.message },
      { status: 500 },
    )
  }

  const { data: publicData } = supabase.storage
    .from(TOURNAMENT_COVERS_BUCKET)
    .getPublicUrl(objectKey)
  // Cache-bust on replace by appending a timestamp query.
  const coverUrl = `${publicData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('tournaments')
    .update({ cover_image_url: coverUrl })
    .eq('id', tournamentId)
  if (updateError) {
    return NextResponse.json(
      { error: 'db_update_failed', detail: updateError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, cover_image_url: coverUrl })
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id: tournamentId } = await ctx.params
  if (!tournamentId) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('tournaments')
    .update({ cover_image_url: null })
    .eq('id', tournamentId)
  if (error) {
    return NextResponse.json(
      { error: 'db_update_failed', detail: error.message },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
