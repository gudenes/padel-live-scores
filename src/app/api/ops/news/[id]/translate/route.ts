// src/app/api/ops/news/[id]/translate/route.ts
// POST /api/ops/news/:id/translate?locale=es  → re-translate one locale
// POST /api/ops/news/:id/translate            → re-translate all 4

import { checkOpsAuth } from '@/lib/ops-auth'
import { translateAndStore, translateOneLocale } from '@/lib/news-translate-job'
import { createClient } from '@supabase/supabase-js'
import type { NewsPost } from '@/types/news'
import type { SupportedLocale } from '@/lib/news-translator'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const VALID_LOCALES: SupportedLocale[] = ['es', 'pt', 'it', 'fr']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params
  const url = new URL(req.url)
  const localeParam = url.searchParams.get('locale')

  if (localeParam && !VALID_LOCALES.includes(localeParam as SupportedLocale)) {
    return Response.json({ error: 'invalid locale' }, { status: 400 })
  }

  try {
    if (localeParam) {
      await translateOneLocale(id, localeParam as SupportedLocale)
      return Response.json({ ok: true, locale: localeParam })
    }

    const { data, error } = await supabase
      .from('news_posts')
      .select('*')
      .eq('id', id)
      .eq('locale', 'en')
      .single()
    if (error || !data) return Response.json({ error: 'EN post not found' }, { status: 404 })

    const result = await translateAndStore(data as NewsPost)
    return Response.json({ ok: true, ...result })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
