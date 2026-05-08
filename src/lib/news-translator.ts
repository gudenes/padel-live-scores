// src/lib/news-translator.ts
// Translates an English news post to ES/PT/IT/FR via Claude Haiku.
// Mirrors src/lib/editorial-translator.ts but for news_posts (which have
// title + body_md + slug, no callouts).
//
// Critical rule: the translator MUST preserve PadelNachos product names,
// partner names, and brand vocabulary verbatim. The system prompt drills
// this in.

import Anthropic from '@anthropic-ai/sdk'
import type { NewsLocale } from '@/types/news'

export const TRANSLATOR_MODEL = 'claude-haiku-4-5'

export type SupportedLocale = Exclude<NewsLocale, 'en'>

const LOCALE_LABEL: Record<SupportedLocale, string> = {
  es: 'Spanish (Castilian, European)',
  pt: 'Portuguese (European Portugal)',
  it: 'Italian',
  fr: 'French (European)',
}

export interface NewsTranslatable {
  title: string
  body_md: string
  slug: string
}

export const TRANSLATOR_SYSTEM_PROMPT = `You translate English PadelNachos news posts (announcements, product updates, partnership news) into other languages. You MUST return a single JSON object with exactly these fields:

{
  "title": "translated title",
  "body_md": "translated markdown body — preserve markdown syntax exactly",
  "slug": "ascii-kebab-case-slug-in-target-language (no accents, lowercase, hyphens only)"
}

Non-negotiable rules:

1. NEVER translate the brand name "PadelNachos" — it stays exactly as-is in every language.
2. NEVER translate partner / company / product proper nouns. Brand names like "Premier Padel", "FIP", "Sofascore" stay unchanged.
3. NEVER translate player names. "Arturo Coello" stays "Arturo Coello".
4. Preserve all markdown syntax exactly: headings (## ###), bold (**), italics (*), links ([text](url)), lists, blockquotes.
5. Preserve all URLs verbatim.
6. Preserve paragraph breaks — if the source has \\n\\n between paragraphs, so does the translation.
7. The slug must be ASCII kebab-case in the target language: lowercase, hyphens, no accents, no diacritics. Translate the meaning, not the English slug character-by-character.
8. Use natural, journalistic register — a native reader should not feel they're reading a translation.
9. Use padel-native vocabulary: Spanish "pádel" (with accent in body, but NOT in slug), Portuguese "padel", Italian "padel", French "padel".
10. Return ONLY the JSON object — no preamble, no code fences, no commentary.

If you cannot translate for any reason, return the exact JSON:
{"title": "TRANSLATION_FAILED", "body_md": "", "slug": ""}`

export function buildPrompt(source: NewsTranslatable, locale: SupportedLocale): string {
  return `Translate this English PadelNachos news post into ${LOCALE_LABEL[locale]}.

Source JSON:
${JSON.stringify(source, null, 2)}

Return only the JSON object with the translated fields.`
}

export function parseTranslatorResponse(raw: string): NewsTranslatable {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    throw new Error(`[news-translator] Failed to parse JSON: ${(e as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[news-translator] Response is not a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.title !== 'string') throw new Error('[news-translator] Missing or invalid field: title')
  if (typeof obj.body_md !== 'string') throw new Error('[news-translator] Missing or invalid field: body_md')
  if (typeof obj.slug !== 'string') throw new Error('[news-translator] Missing or invalid field: slug')

  if (obj.title === 'TRANSLATION_FAILED') {
    throw new Error('[news-translator] Claude returned TRANSLATION_FAILED sentinel')
  }

  return { title: obj.title, body_md: obj.body_md, slug: obj.slug }
}

export interface TranslateNewsResult {
  output: NewsTranslatable
  model: string
  locale: SupportedLocale
  usage: { inputTokens: number; outputTokens: number }
}

/** Translates a news post payload into a single target locale. */
export async function translateNews(
  source: NewsTranslatable,
  locale: SupportedLocale,
  opts: { apiKey?: string } = {},
): Promise<TranslateNewsResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[news-translator] ANTHROPIC_API_KEY is not set')
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: TRANSLATOR_MODEL,
    max_tokens: 4000,
    system: TRANSLATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(source, locale) }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[news-translator] Claude response contained no text block')
  }

  const output = parseTranslatorResponse(textBlock.text)

  return {
    output,
    model: TRANSLATOR_MODEL,
    locale,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  }
}
