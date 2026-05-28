import { describe, it, expect, vi } from 'vitest'
import { fetchClusteredNews, type ArticleRow } from '../news-feed-queries'

function makeSupabaseMock(rows: ArticleRow[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return { from: vi.fn().mockReturnValue(builder) } as never
}

const FIXTURE: ArticleRow[] = [
  { id: 'a', title: 'Galán Chingotto a la final', source_name: 'FIP', source_url: 'https://x', source_key: 'fip', image_url: null, language: 'es', published_at: '2026-05-28T10:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
  { id: 'b', title: 'Galán y Chingotto llegan a la final', source_name: 'Padel Addict', source_url: 'https://y', source_key: 'padel-addict', image_url: null, language: 'es', published_at: '2026-05-28T09:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
  { id: 'c', title: 'Tapia y Coello caen', source_name: 'beIN', source_url: 'https://z', source_key: 'bein', image_url: null, language: 'es', published_at: '2026-05-28T08:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
]

describe('fetchClusteredNews', () => {
  it('clusters articles by default and returns ClusteredArticle[]', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    const result = await fetchClusteredNews(supabase, { limit: 50 })
    expect(result).toHaveLength(2)
    expect(result[0].primary.id).toBe('a')
    expect(result[0].siblings.map(s => s.id)).toEqual(['b'])
    expect(result[1].primary.id).toBe('c')
    expect(result[1].siblings).toEqual([])
  })

  it('with applyDedup=false returns every article as primary, no siblings', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    const result = await fetchClusteredNews(supabase, { applyDedup: false })
    expect(result).toHaveLength(3)
    result.forEach(c => expect(c.siblings).toEqual([]))
  })

  it('returns empty array on supabase error', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
      }),
    } as never
    const result = await fetchClusteredNews(supabase, {})
    expect(result).toEqual([])
  })

  it('respects limit option (default 50)', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    await fetchClusteredNews(supabase, { limit: 10 })
    const builder = (supabase as { from: () => { limit: ReturnType<typeof vi.fn> } }).from()
    expect(builder.limit).toHaveBeenCalledWith(10)
  })
})
