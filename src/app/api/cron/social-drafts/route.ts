// src/app/api/cron/social-drafts/route.ts
// Weekly social content generator — pulls top matches from Supabase,
// sends to Claude API for post drafts, saves back to social_posts table.
// Schedule: Monday 8am UTC (vercel.json)

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Supabase: get this week's finished matches ─────────────────

interface MatchRow {
  id: string
  round: string | null
  category: string | null
  winner_pair: 1 | 2 | null
  scheduled_at: string | null
  finished_at: string | null
  tournament: { name: string; level: string | null; country: string | null } | null
  pair1_player1: { name: string; ranking: number | null } | null
  pair1_player2: { name: string; ranking: number | null } | null
  pair2_player1: { name: string; ranking: number | null } | null
  pair2_player2: { name: string; ranking: number | null } | null
  sets: { set_number: number; pair1_games: number | null; pair2_games: number | null }[]
}

async function getWeekTopMatches(): Promise<MatchRow[]> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, round, category, winner_pair, scheduled_at, finished_at,
      tournament:tournaments(name, level, country),
      pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking),
      sets(set_number, pair1_games, pair2_games)
    `)
    .eq('status', 'finished')
    .not('winner_pair', 'is', null)
    .gte('finished_at', sevenDaysAgo.toISOString())
    .order('finished_at', { ascending: false })
    .limit(30)

  if (error) {
    console.error('[Social Drafts] Supabase query error:', error.message)
    return []
  }

  return (data as unknown as MatchRow[]) || []
}

// ── Format matches for Claude ──────────────────────────────────

function formatScore(sets: MatchRow['sets']): string {
  return sets
    .sort((a, b) => a.set_number - b.set_number)
    .map(s => `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)
    .join(' ')
}

function pairName(p1: { name: string } | null, p2: { name: string } | null): string {
  if (!p1 && !p2) return 'TBD'
  if (!p2) return p1!.name
  if (!p1) return p2.name
  const last = (n: string) => n.split(' ').pop() || n
  return `${last(p1.name)}/${last(p2.name)}`
}

function formatMatchesForClaude(matches: MatchRow[]): string {
  const scored = matches
    .filter(m => m.sets.length > 0 && m.pair1_player1)
    .map(m => {
      const pair1 = pairName(m.pair1_player1, m.pair1_player2)
      const pair2 = pairName(m.pair2_player1, m.pair2_player2)
      const winner = m.winner_pair === 1 ? pair1 : pair2
      const loser = m.winner_pair === 1 ? pair2 : pair1
      const score = formatScore(m.sets)
      const round = m.round || 'Unknown round'
      const tournament = m.tournament?.name || 'Unknown tournament'
      const level = m.tournament?.level || ''
      const cat = m.category === 'women' ? "Women's" : "Men's"

      let interest = 0
      if (round.toLowerCase().includes('final')) interest += 5
      if (round.toLowerCase().includes('semi')) interest += 3
      if (round.toLowerCase().includes('quarter')) interest += 2
      if (m.sets.length >= 3) interest += 2
      if (m.category === 'women') interest += 1

      return {
        line: `${cat} ${round} | ${tournament} (${level}) | ${winner} beat ${loser} ${score}`,
        interest,
      }
    })
    .sort((a, b) => b.interest - a.interest)

  return scored.slice(0, 10).map(s => s.line).join('\n')
}

// ── Supabase: save posts ───────────────────────────────────────

interface SocialPost {
  title: string
  pillar: string
  platforms: string[]
  caption: string
  hashtags: string
  sourceData: string
}

async function savePosts(posts: SocialPost[]): Promise<number> {
  // Flatten: one row per platform per post
  const rows = posts.flatMap(post =>
    post.platforms.map(platform => ({
      title: post.title,
      caption: post.caption,
      hashtags: post.hashtags,
      platform,
      pillar: post.pillar,
      status: 'draft',
      source_data: post.sourceData,
    }))
  )

  if (!rows.length) return 0

  const { data, error } = await supabase
    .from('social_posts')
    .insert(rows)
    .select('id')

  if (error) {
    console.error('[Social Drafts] Insert error:', error.message)
    return 0
  }

  return data?.length || 0
}

// ── Claude API: generate posts ─────────────────────────────────

const SYSTEM_PROMPT = `You are the social media engine for PadelNachos (padelnachos.com).
Generate social posts from the match data provided.
Return ONLY valid JSON — no markdown, no explanation, no code fences.
Format: { "posts": [ { "title": string, "pillar": string, "platforms": string[], "caption": string, "hashtags": string, "sourceData": string } ] }

Pillars: Match Highlight, Tournament Preview, Player Spotlight, Prediction/Poll, Women Coverage, Weekly Roundup
Platforms: Instagram, X/Twitter, TikTok

Brand voice rules:
- Energetic but not cringe. Think sports journalist, not hype bot.
- Short sentences. Punchy. Real padel fan energy.
- Spanish padel terms are fine (bandeja, vibora, etc.)
- Always cover women's matches with equal energy — this is a PadelNachos differentiator.
- Include #PadelNachos #padel in all hashtags. Add #womenpadel for women's matches.
- For X/Twitter posts: max 240 characters for the caption.
- For Instagram: 3-5 sentences + 5-8 hashtags.

Generate 5-8 posts total covering the most interesting moments. Create separate posts for each platform when appropriate.
Never make up scores or player names — only use what's provided.`

async function generatePosts(matchSummary: string): Promise<SocialPost[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[Social Drafts] ANTHROPIC_API_KEY not set')
    return []
  }

  const anthropic = new Anthropic({ apiKey })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Here are this week's top padel matches. Generate social posts:\n\n${matchSummary}`,
    }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{"posts":[]}'

  try {
    const parsed = JSON.parse(raw)
    return parsed.posts || []
  } catch {
    console.error('[Social Drafts] Failed to parse Claude response:', raw.slice(0, 200))
    return []
  }
}

// ── Main handler ───────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const matches = await getWeekTopMatches()
  if (!matches.length) {
    return Response.json({ message: 'No finished matches this week', postsGenerated: 0 })
  }

  const summary = formatMatchesForClaude(matches)
  console.log(`[Social Drafts] Found ${matches.length} matches, sending top 10 to Claude`)

  const posts = await generatePosts(summary)
  if (!posts.length) {
    return Response.json({ message: 'Claude returned no posts', matchesFound: matches.length, postsGenerated: 0 })
  }

  const saved = await savePosts(posts)
  console.log(`[Social Drafts] Generated ${posts.length} posts, saved ${saved} rows to social_posts`)

  return Response.json({
    success: true,
    matchesFound: matches.length,
    postsGenerated: posts.length,
    rowsSaved: saved,
  })
}
