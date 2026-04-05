import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: { id: string; type: 'article' | 'video' }[] = body.items

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return NextResponse.json({ error: 'Invalid items (1-50)' }, { status: 400 })
    }

    const supabase = createServerClient()
    const articleIds = items.filter(i => i.type === 'article').map(i => i.id)
    const videoIds = items.filter(i => i.type === 'video').map(i => i.id)

    if (articleIds.length > 0) {
      await supabase.rpc('increment_impressions_articles', { article_ids: articleIds })
    }
    if (videoIds.length > 0) {
      await supabase.rpc('increment_impressions_highlights', { highlight_ids: videoIds })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
