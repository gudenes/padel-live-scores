// apps/ops/src/app/api/internal/news/[id]/route.ts
// GET single EN post (for editing).
// PUT update EN post (and re-translate on publish).
// DELETE — cascades through translations via FK ON DELETE CASCADE.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { translateAndStore } from '@/lib/news-translate-job'
import type { NewsCategory, NewsPost } from '@/types/news'

const ALLOWED_CATEGORIES: NewsCategory[] = ['announcements', 'product', 'insights']

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { id } = await params

  const { data, error } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', id)
    .eq('locale', 'en')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Post not found' }, { status: 404 })

  return Response.json({ post: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { id } = await params

  let body: {
    title?: string
    category?: string
    body_md?: string
    cover_image_url?: string | null
    status?: 'draft' | 'published'
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data: current, error: fetchErr } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', id)
    .eq('locale', 'en')
    .single()

  if (fetchErr || !current) {
    return Response.json({ error: 'Post not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.body_md !== undefined) updates.body_md = body.body_md
  if (body.cover_image_url !== undefined) updates.cover_image_url = body.cover_image_url
  if (body.category !== undefined) {
    if (!ALLOWED_CATEGORIES.includes(body.category as NewsCategory)) {
      return Response.json({ error: 'invalid category' }, { status: 400 })
    }
    updates.category = body.category
  }

  const wasPublished = current.status === 'published'
  const willBePublished = body.status === 'published' || (body.status === undefined && wasPublished)

  if (body.status !== undefined) {
    updates.status = body.status
    if (body.status === 'published' && !current.published_at) {
      updates.published_at = new Date().toISOString()
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('news_posts')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (updateErr || !updated) {
    return Response.json({ error: updateErr?.message ?? 'Update failed' }, { status: 500 })
  }

  if (willBePublished) {
    try {
      await translateAndStore(updated as NewsPost)
    } catch (e) {
      console.error('[PUT /api/internal/news/:id] Translation failed:', (e as Error).message)
    }
  }

  return Response.json({ post: updated })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { id } = await params

  const { error } = await supabase
    .from('news_posts')
    .delete()
    .eq('id', id)
    .eq('locale', 'en')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
