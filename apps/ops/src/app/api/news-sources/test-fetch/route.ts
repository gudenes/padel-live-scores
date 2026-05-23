import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import Parser from 'rss-parser'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { url } = await req.json() as { url?: string }
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 })

  const parser = new Parser({ timeout: 15000 })
  try {
    const feed = await parser.parseURL(url)
    const sample = feed.items.slice(0, 3).map(i => ({
      title: i.title,
      link: i.link,
      pubDate: i.pubDate,
      snippet: i.contentSnippet?.slice(0, 200),
    }))
    return NextResponse.json({
      ok: true,
      feedTitle: feed.title,
      count: feed.items.length,
      sample,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message })
  }
}
