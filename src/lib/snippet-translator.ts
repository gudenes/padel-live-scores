// src/lib/snippet-translator.ts
//
// Tiny Anthropic wrapper that translates a single article snippet into
// the user's locale. Used by /api/articles/[id]/translate behind a
// Postgres JSONB cache (articles.snippet_translations) so each
// (article, locale) pair only ever costs one Haiku call.
//
// Why a dedicated lib (vs. inlining the SDK call):
//   - Keeps the prompt + model choice in one place so future tweaks
//     (e.g., switching to a different model per locale, adding a
//     padel-jargon glossary) live next to the call site that uses
//     them.
//   - Lets us unit-test the response-extraction logic without spinning
//     up the full route.
//
// Cost model: Haiku 4.5 at $1/M input + $5/M output, snippets ~80 tokens
// in/out → ~$0.0005 per call. With ~1k DAU × 2 expand/day × 50% foreign
// language → ~1000 calls/day for new (article, locale) pairs, ~$0.50/day
// at peak. Reality is far lower because the cache is shared across users.

import Anthropic from '@anthropic-ai/sdk'

// Haiku 4.5 — fast + cheap, plenty smart for short news snippets.
const TRANSLATION_MODEL = 'claude-haiku-4-5-20251001'

// Map app locales → human-readable names for the prompt. Claude needs
// the language name, not the ISO code, to produce idiomatic output.
const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  fr: 'French',
}

export type SupportedLocale = keyof typeof LOCALE_NAMES

export function isSupportedLocale(s: string): s is SupportedLocale {
  return s in LOCALE_NAMES
}

export interface TranslateInput {
  /** Source snippet text (max ~500 chars expected). */
  snippet: string
  /** ISO 2-letter source language code from articles.language. */
  sourceLocale: string
  /** Target locale (one of the 5 app locales). */
  targetLocale: SupportedLocale
}

export interface TranslateResult {
  translation: string
  inputTokens: number
  outputTokens: number
}

/**
 * Translate a single news snippet into the target locale.
 *
 * Throws if ANTHROPIC_API_KEY is missing or Claude returns no text. The
 * caller is expected to wrap this in a cache-first lookup (see the
 * /api/articles/[id]/translate route) — DON'T call directly per request,
 * you'll burn money translating the same snippet over and over.
 */
export async function translateSnippet(
  input: TranslateInput,
  opts: { apiKey?: string } = {},
): Promise<TranslateResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[snippet-translator] ANTHROPIC_API_KEY is not set')
  }

  const targetName = LOCALE_NAMES[input.targetLocale]
  // The system prompt is intentionally short. We're translating ~80 tokens
  // of text — making the system prompt longer would cost more than the
  // translation itself. Padel-jargon hint kept terse so model stays
  // focused on idiomatic output.
  const system = [
    `Translate the user's news snippet into ${targetName}.`,
    'It\'s about professional padel (tennis-like sport). Keep player names, tournament names, and scores exactly as in the source.',
    'Output ONLY the translation. No preamble, no quotes, no commentary.',
  ].join(' ')

  const anthropic = new Anthropic({ apiKey })

  const message = await anthropic.messages.create({
    model: TRANSLATION_MODEL,
    max_tokens: 400, // generous — typical snippet is <100 output tokens
    system,
    messages: [
      {
        role: 'user',
        content: input.snippet,
      },
    ],
  })

  const text = extractText(message)
  if (!text) {
    throw new Error('[snippet-translator] Claude returned no text block')
  }

  return {
    translation: text.trim(),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

function extractText(message: Anthropic.Message): string | null {
  for (const block of message.content) {
    if (block.type === 'text') return block.text
  }
  return null
}

// ────────────────────────────────────────────────────────────────────
// Bundled title translation
//
// Used by sync-articles on ingest: every new article needs a title
// translation in EACH non-source locale because the home carousel
// shows titles to every user regardless of whether they expand a card.
// Doing this with 4 separate Claude calls per article would 4× the
// cost; bundling into one call is ~70% cheaper per article and
// completes in one network round-trip.
//
// We ask Claude to return strict JSON with one key per target locale.
// On parse failure we fall back to the source title in all locales —
// the UI gracefully falls back to article.title when a translation
// is missing, so a malformed Claude response just means "no
// translation for this article" not "broken sync."

export interface TitleBundleInput {
  title: string
  sourceLocale: string // ISO 2-letter
}

export interface TitleBundleResult {
  /** Map of locale → translated title, omitting the source locale. */
  translations: Partial<Record<SupportedLocale, string>>
  inputTokens: number
  outputTokens: number
}

export async function translateTitleBundle(
  input: TitleBundleInput,
  opts: { apiKey?: string } = {},
): Promise<TitleBundleResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[snippet-translator] ANTHROPIC_API_KEY is not set')
  }

  // Targets = all supported locales except the source. If the source
  // isn't recognised (e.g., articles.language is null) we translate
  // into all 5 to be safe; the UI still falls back to source title for
  // the unknown source language.
  const sourceShort = input.sourceLocale.slice(0, 2).toLowerCase()
  const targets = Object.keys(LOCALE_NAMES).filter(l => l !== sourceShort) as SupportedLocale[]

  const targetList = targets.map(l => `"${l}" (${LOCALE_NAMES[l]})`).join(', ')

  const system = [
    'You translate professional padel news article titles.',
    `Return ONLY a strict JSON object with these exact keys: ${targetList}.`,
    'Each value must be the title translated into that language. Keep player names, tournament names, and scores exactly as in the source.',
    'No preamble, no commentary, no markdown — just the JSON object.',
  ].join(' ')

  const anthropic = new Anthropic({ apiKey })

  const message = await anthropic.messages.create({
    model: TRANSLATION_MODEL,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: input.title }],
  })

  const text = extractText(message)?.trim()
  if (!text) {
    throw new Error('[snippet-translator] title bundle: no text block')
  }

  // Strip markdown fences in case the model wraps the JSON despite
  // the system prompt asking it not to.
  const jsonStr = stripCodeFences(text)
  let parsed: Partial<Record<SupportedLocale, string>>
  try {
    parsed = JSON.parse(jsonStr) as Partial<Record<SupportedLocale, string>>
  } catch {
    throw new Error(`[snippet-translator] title bundle: malformed JSON — ${jsonStr.slice(0, 120)}`)
  }

  // Filter to only supported keys with non-empty string values; this
  // protects against the model adding unexpected keys or returning
  // null/empty values for some locales.
  const translations: Partial<Record<SupportedLocale, string>> = {}
  for (const k of targets) {
    const v = parsed[k]
    if (typeof v === 'string' && v.trim().length > 0) {
      translations[k] = v.trim()
    }
  }

  return {
    translations,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

function stripCodeFences(s: string): string {
  // Match ```json … ``` or ``` … ``` and return the inside.
  const m = s.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/)
  return m ? m[1]! : s
}
