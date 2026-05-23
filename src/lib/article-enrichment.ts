import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extract } from '@extractus/article-extractor'
import GoogleNewsDecoder from 'google-news-decoder'
import { ARTICLE_TOPICS, isValidTopic, type ArticleTopic } from './article-topics'
import { resolveEntity, type EntityType } from './entity-resolver'

const SONNET_MODEL = 'claude-sonnet-4-5'
const HAIKU_MODEL  = 'claude-haiku-4-5'
const MIN_BODY_CHARS = 500
const MAX_INPUT_TOKENS_APPROX = 8000
const TARGET_LOCALES = ['es', 'pt', 'it', 'fr'] as const

const SYSTEM_PROMPT = `You are extracting structured padel news data from an article body.
Return a single JSON object matching this schema (no prose, no markdown fences):

{
  "summary_md": "A single paragraph of 60-80 words summarising the article. Bold key terms with **markdown bold**. No bullets, no line breaks.",
  "entities": [{ "type": "player|tournament|brand", "mention": "verbatim string", "confidence": 0.0-1.0 }],
  "topics": [{ "topic": "${ARTICLE_TOPICS.join('|')}", "confidence": 0.0-1.0 }]
}

Rules for summary_md:
- ONE paragraph. No bullets ("•"), no line breaks ("\\n").
- 60-80 words. Tight, declarative. Lead with the news, follow with context.
- English (the canonical; translations to other locales happen in a separate Haiku call).
- **Bold** the key player names, tournament names, and scorelines.
- No clichés ("a thrilling match"). No author voice ("I think", "we see").

Rules for entities and topics:
- Confidence on entities reflects how sure you are it's THIS specific entity, not just that the name appears.
- Don't invent entities. Only return mentions that appear in the article.`

// ── Body extraction ────────────────────────────────────────────────────

export interface FetchedBody {
  text: string
  title: string | null
}

/** Strip HTML tags to get plain text. The extractor returns content as HTML
 *  (preserving paragraph structure); Claude works better with plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Google News RSS URLs are aliases — decode to the real article URL.
 *  Returns the input unchanged for non-Google-News URLs. */
async function resolveRedirect(url: string): Promise<string> {
  if (!url.includes('news.google.com')) return url
  const decoder = new GoogleNewsDecoder()
  const result = await decoder.decodeGoogleNewsUrl(url) as { status: boolean; decodedUrl?: string; message?: string }
  if (result?.status && result.decodedUrl) return result.decodedUrl
  throw new Error(`google_news_decode_failed: ${result?.message ?? 'unknown'}`)
}

export async function fetchArticleBody(url: string, timeoutMs = 15000): Promise<FetchedBody> {
  // Decode Google News URLs first — pending rows from pre-enrichment ingest
  // still carry raw news.google.com/rss/articles/... that need to be resolved.
  const realUrl = await resolveRedirect(url)

  // @extractus/article-extractor wraps node-fetch under the hood; we cap with Promise.race for timeout.
  const article = await Promise.race([
    extract(realUrl),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]) as Awaited<ReturnType<typeof extract>>

  if (!article || !article.content) {
    throw new Error('no_article_content')
  }
  const text = htmlToText(article.content)
  if (text.length < MIN_BODY_CHARS) {
    throw new Error(`body_too_short:${text.length}`)
  }
  return { text, title: article.title ?? null }
}

// ── Claude call ────────────────────────────────────────────────────────

export interface EnrichmentResult {
  summary_md: string
  entities: Array<{ type: EntityType; mention: string; confidence: number }>
  topics: Array<{ topic: ArticleTopic; confidence: number }>
}

export async function callSonnetForEnrichment(
  client: Anthropic,
  headline: string,
  body: string,
): Promise<EnrichmentResult> {
  const truncated = truncateToApproxTokens(body, MAX_INPUT_TOKENS_APPROX)
  const userPrompt = `HEADLINE: ${headline}\n\nBODY:\n${truncated}`

  const res = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = res.content.find(c => c.type === 'text')
  if (!block || block.type !== 'text') throw new Error('claude: no text block in response')
  const parsed = parseClaudeResponse(block.text)
  validateEnrichmentShape(parsed)
  return parsed
}

export function parseClaudeResponse(raw: string): EnrichmentResult {
  let str = raw.trim()
  // Tolerate ```json ... ``` fenced output even though we asked for raw JSON.
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }
  return JSON.parse(str) as EnrichmentResult
}

export function validateEnrichmentShape(obj: unknown): asserts obj is EnrichmentResult {
  if (typeof obj !== 'object' || obj === null) throw new Error('not an object')
  const o = obj as Record<string, unknown>
  if (typeof o.summary_md !== 'string') throw new Error('summary_md must be string')
  if (!Array.isArray(o.entities)) throw new Error('entities must be array')
  if (!Array.isArray(o.topics)) throw new Error('topics must be array')
  for (const e of o.entities as Array<Record<string, unknown>>) {
    if (!['player', 'tournament', 'brand'].includes(e.type as string)) throw new Error(`invalid entity type: ${e.type}`)
    if (typeof e.mention !== 'string' || !e.mention) throw new Error('entity.mention must be non-empty string')
    if (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1) throw new Error('entity.confidence out of range')
  }
  for (const t of o.topics as Array<Record<string, unknown>>) {
    if (!isValidTopic(t.topic as string)) throw new Error(`unknown topic: ${t.topic}`)
    if (typeof t.confidence !== 'number' || t.confidence < 0 || t.confidence > 1) throw new Error('topic.confidence out of range')
  }
}

// ── Translation ────────────────────────────────────────────────────────

export async function translateSummary(
  client: Anthropic,
  summaryMd: string,
): Promise<Record<typeof TARGET_LOCALES[number], string>> {
  const res = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    system: 'You translate padel news bullet summaries. Preserve "• " bullets, bold markdown, line breaks. Return a single JSON object keyed by locale code. No prose, no fences.',
    messages: [{
      role: 'user',
      content: `Translate the following English summary to: ${TARGET_LOCALES.join(', ')}.\n\nReturn shape: {"es": "...", "pt": "...", "it": "...", "fr": "..."}\n\nSummary:\n${summaryMd}`,
    }],
  })
  const block = res.content.find(c => c.type === 'text')
  if (!block || block.type !== 'text') throw new Error('claude: no text block in translation response')
  let raw = block.text.trim()
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(raw)
  for (const locale of TARGET_LOCALES) {
    if (typeof parsed[locale] !== 'string') throw new Error(`translation missing for ${locale}`)
  }
  return parsed
}

// ── Linking (write to DB) ──────────────────────────────────────────────

export interface LinkResult {
  linkedCount: number
  droppedCount: number
}

export async function linkEntitiesToArticle(
  supabase: SupabaseClient,
  articleId: string,
  entities: EnrichmentResult['entities'],
  minProduct = 0.7,
): Promise<LinkResult> {
  let linked = 0, dropped = 0
  for (const e of entities) {
    const resolved = await resolveEntity(supabase, e.type, e.mention)
    if (!resolved) { dropped++; continue }
    const product = e.confidence * resolved.confidence
    if (product < minProduct) { dropped++; continue }
    const { error } = await supabase
      .from('article_entities')
      .upsert({
        article_id: articleId,
        entity_type: e.type,
        entity_id: resolved.entityId,
        mention_text: e.mention,
        confidence: product,
      }, { onConflict: 'article_id,entity_type,entity_id' })
    if (error) { dropped++; continue }
    linked++
  }
  return { linkedCount: linked, droppedCount: dropped }
}

export async function insertArticleTopics(
  supabase: SupabaseClient,
  articleId: string,
  topics: EnrichmentResult['topics'],
): Promise<void> {
  if (topics.length === 0) return
  const rows = topics.map(t => ({
    article_id: articleId,
    topic: t.topic,
    confidence: t.confidence,
  }))
  await supabase.from('article_topics').upsert(rows, { onConflict: 'article_id,topic' })
}

// ── Helpers ────────────────────────────────────────────────────────────

function truncateToApproxTokens(text: string, approxTokens: number): string {
  const maxChars = approxTokens * 4
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}
