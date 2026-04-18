// src/lib/editorial-translator.ts
// Translates an English editorial post to ES/PT/IT/FR via Claude Haiku.
//
// Translation is a tightly-scoped task: preserve meaning, names, scores, and
// tournament names verbatim; adapt idioms. Haiku 4.5 is plenty for this and
// costs roughly 1/5 of Opus. We translate the four text fields in a single
// call per locale to keep round-trips low.
//
// Critical rule: the translator MUST preserve player names, tournament names,
// and scores byte-for-byte. The system prompt drills this in.

import Anthropic from '@anthropic-ai/sdk'
import type { EditorialOutput } from './editorial-prompts'

export const TRANSLATOR_MODEL = 'claude-haiku-4-5'

export type SupportedLocale = 'es' | 'pt' | 'it' | 'fr'

const LOCALE_LABEL: Record<SupportedLocale, string> = {
  es: 'Spanish (Castilian, European)',
  pt: 'Portuguese (European Portugal)',
  it: 'Italian',
  fr: 'French (European)',
}

export const TRANSLATOR_SYSTEM_PROMPT = `You translate English padel editorial content into other languages for PadelNachos. You MUST return a single JSON object with exactly these fields:

{
  "headline": "translated headline",
  "lead": "translated lead paragraph",
  "body": "translated full body (paragraphs separated by \\n\\n)",
  "calloutKey": "translated key or null",
  "calloutValue": "translated value or null (scores are NEVER translated)"
}

Non-negotiable rules:

1. NEVER translate player names. "Arturo Coello" stays "Arturo Coello" in every language.
2. NEVER translate tournament names. "Milan Premier Padel P1 2026" stays exactly the same.
3. NEVER translate match scores or set scores. "6-3, 3-6, 7-6(4)" is identical in every language.
4. NEVER translate proper nouns like "Premier Padel", "FIP", "WPT", "APT", "P1", "P2", "Major".
5. Currency amounts stay the same: "$525k" stays "$525k".
6. Preserve paragraph breaks — if the English body has 3 paragraphs separated by \\n\\n, so does the translation.
7. Preserve inline emphasis and punctuation style consistent with the target language (Spanish uses ¿? for questions, French uses guillemets «», etc.).
8. Natural-sounding, journalistic register — not literal word-for-word. A sports fan in Madrid should read it and not think "this was translated".
9. Use padel-native vocabulary for the target language: Spanish "pádel" (with accent), Portuguese "padel", Italian "padel", French "padel".
10. Return ONLY the JSON object — no preamble, no code fences, no commentary.

If you cannot translate for any reason, return the exact JSON:
{"headline": "TRANSLATION_FAILED", "lead": "", "body": "", "calloutKey": null, "calloutValue": null}`

export interface TranslateEditorialResult {
  output: EditorialOutput
  model: string
  locale: SupportedLocale
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

/**
 * Translates an English EditorialOutput into the target locale.
 */
export async function translateEditorial(
  source: EditorialOutput,
  locale: SupportedLocale,
  opts: { apiKey?: string } = {},
): Promise<TranslateEditorialResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[editorial-translator] ANTHROPIC_API_KEY is not set')
  }

  const anthropic = new Anthropic({ apiKey })

  const userPrompt = `Translate this English padel editorial into ${LOCALE_LABEL[locale]}.

Source JSON:
${JSON.stringify(source, null, 2)}

Return only the JSON object with the translated fields.`

  const message = await anthropic.messages.create({
    model: TRANSLATOR_MODEL,
    max_tokens: 4000,
    system: TRANSLATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = extractFirstTextBlock(message)
  if (!text) {
    throw new Error('[editorial-translator] Claude response contained no text block')
  }

  const output = parseTranslatorResponse(text)
  if (output.headline === 'TRANSLATION_FAILED') {
    throw new Error('[editorial-translator] Claude returned TRANSLATION_FAILED sentinel')
  }

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

function extractFirstTextBlock(message: Anthropic.Message): string | null {
  for (const block of message.content) {
    if (block.type === 'text') return block.text
  }
  return null
}

// Same parser shape as editorial-prompts.parseEditorialResponse but without
// the INSUFFICIENT_DATA sentinel — the translator has its own TRANSLATION_FAILED
// sentinel that callers handle explicitly.
function parseTranslatorResponse(raw: string): EditorialOutput {
  const cleaned = stripCodeFence(raw).trim()
  const json = extractFirstJsonObject(cleaned)
  if (!json) throw new Error('[editorial-translator] No JSON object in response')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(`[editorial-translator] JSON.parse failed: ${(err as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[editorial-translator] Response is not an object')
  }

  const obj = parsed as Record<string, unknown>
  const req = (k: string): string => {
    const v = obj[k]
    if (typeof v !== 'string') throw new Error(`[editorial-translator] Field "${k}" missing or not a string`)
    return v
  }
  const opt = (k: string): string | null => {
    const v = obj[k]
    if (v == null) return null
    if (typeof v === 'string') return v.length === 0 ? null : v
    throw new Error(`[editorial-translator] Field "${k}" must be string or null`)
  }

  return {
    headline: req('headline'),
    lead: req('lead'),
    body: req('body'),
    calloutKey: opt('calloutKey'),
    calloutValue: opt('calloutValue'),
  }
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return fenced ? fenced[1] : s
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0, inString = false, escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1) }
  }
  return null
}
