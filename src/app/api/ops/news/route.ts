// src/app/api/ops/news/route.ts
// List + create news posts. Auth: ops_token cookie.
// All writes go through the service-key client (bypasses RLS).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { generateSlug } from '@/lib/news-slug'
import type { NewsCategory, NewsPost } from '@/types/news'
import { translateAndStore } from '@/lib/news-translate-job'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ALLOWED_CATEGORIES: NewsCategory[] = ['announcements', 'product', 'insights']

// GET: list all EN rows (drafts + published) with translation status counts
export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { data: enRows, error: enErr } = await supabase
    .from('news_posts')
    .select('id, category, slug, title, status, published_at, updated_at, cover_image_url')
    .eq('locale', 'en')
    .order('updated_at', { ascending: false })

  if (enErr) {
    return Response.json({ error: enErr.message }, { status: 500 })
  }

  const enIds = (enRows ?? []).map((r) => r.id)
  const { data: translationRows, error: tErr } = await supabase
    .from('news_posts')
    .select('translated_from, locale')
    .in('translated_from', enIds.length > 0 ? enIds : ['00000000-0000-0000-0000-000000000000'])

  if (tErr) {
    return Response.json({ error: tErr.message }, { status: 500 })
  }

  const translationsByEnId = new Map<string, Set<string>>()
  for (const row of translationRows ?? []) {
    const set = translationsByEnId.get(row.translated_from!) ?? new Set()
    set.add(row.locale)
    translationsByEnId.set(row.translated_from!, set)
  }

  const result = (enRows ?? []).map((post) => ({
    ...post,
    translations: {
      es: translationsByEnId.get(post.id)?.has('es') ?? false,
      pt: translationsByEnId.get(post.id)?.has('pt') ?? false,
      it: translationsByEnId.get(post.id)?.has('it') ?? false,
      fr: translationsByEnId.get(post.id)?.has('fr') ?? false,
    },
  }))

  return Response.json({ posts: result })
}

// POST: create a new post (always EN; translations triggered on publish)
export async function POST(req: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: {
    title?: string
    slug?: string
    category?: string
    body_md?: string
    cover_image_url?: string
    status?: 'draft' | 'published'
  }

  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.title || typeof body.title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.body_md || typeof body.body_md !== 'string') {
    return Response.json({ error: 'body_md is required' }, { status: 400 })
  }
  if (!ALLOWED_CATEGORIES.includes(body.category as NewsCategory)) {
    return Response.json({ error: `category must be one of ${ALLOWED_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  const status = body.status === 'published' ? 'published' : 'draft'
  const slug = (body.slug && body.slug.trim()) || generateSlug(body.title)

  if (!slug) {
    return Response.json({ error: 'slug could not be generated from title' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('news_posts')
    .select('id')
    .eq('locale', 'en')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('news_posts')
    .insert({
      category: body.category,
      locale: 'en',
      slug,
      title: body.title,
      body_md: body.body_md,
      cover_image_url: body.cover_image_url ?? null,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (insertErr || !inserted) {
    return Response.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  if (status === 'published') {
    try {
      await translateAndStore(inserted as NewsPost)
    } catch (e) {
      console.error('[POST /api/ops/news] Translation failed (post still published):', (e as Error).message)
    }
  }

  return Response.json({ post: inserted })
}
