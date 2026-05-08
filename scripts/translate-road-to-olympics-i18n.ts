#!/usr/bin/env npx tsx
/**
 * Translate the `roadToOlympics` i18n namespace from English into ES/PT/IT/FR.
 * Usage: npx tsx scripts/translate-road-to-olympics-i18n.ts
 *
 * Reads ANTHROPIC_API_KEY from process.env (or .env.local via tsx's dotenv support).
 * Writes translated blocks back into src/messages/{locale}.json, replacing only
 * the `roadToOlympics` top-level key.
 */

import * as fs from 'fs'
import * as path from 'path'
import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4096
const MAX_RETRIES = 2

const LOCALE_LABEL: Record<string, string> = {
  es: 'Spanish (Castilian, European)',
  pt: 'Portuguese (European Portugal)',
  it: 'Italian',
  fr: 'French (European)',
}

const MESSAGES_DIR = path.resolve(__dirname, '../src/messages')

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You translate JSON i18n files for PadelNachos, a padel sports app. You receive a JSON object whose values are English UI strings, and you return the SAME JSON object with every string value translated into the requested language.

Non-negotiable rules:

1. Return ONLY a valid JSON object — no preamble, no markdown code fences, no commentary, nothing before or after the JSON.
2. Preserve ALL keys exactly as-is. Never rename, add, or remove keys.
3. Preserve the EXACT JSON structure (nested objects must remain nested identically).
4. Preserve ALL placeholder tokens exactly, including curly braces: {days}, {count}, etc.
5. NEVER translate these brand names / proper nouns — leave them verbatim:
   - #PadelOlympics
   - PadelNachos
   - Premier Padel
   - FIP
   - IOC
   - Brisbane 2032
6. Use natural, journalistic register — a native padel fan should feel the copy was written in their language, not translated.
7. Padel spelling: Spanish uses "pádel" (with accent), all other languages use "padel" (no accent).
8. Olympic Games → translate naturally (e.g. "Jeux Olympiques", "Juegos Olímpicos", "Giochi Olimpici").
9. If a value is already not a plain translatable string (e.g. it is just a symbol or a hashtag like "#PadelOlympics"), leave it unchanged.

If you cannot translate for any reason, return the exact sentinel: {"TRANSLATION_FAILED": true}`

function buildUserPrompt(source: Record<string, unknown>, locale: string): string {
  return `Translate the following JSON object's string values into ${LOCALE_LABEL[locale]}. Return ONLY the JSON object with translated values, same structure, same keys.

${JSON.stringify(source, null, 2)}`
}

// ---------------------------------------------------------------------------
// Shape validation — checks that both objects have the same keys at every depth
// ---------------------------------------------------------------------------

function validateShape(source: unknown, translated: unknown, path = ''): void {
  if (typeof source !== typeof translated) {
    throw new Error(`Shape mismatch at "${path}": source is ${typeof source}, translated is ${typeof translated}`)
  }
  if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
    const srcObj = source as Record<string, unknown>
    const trlObj = translated as Record<string, unknown>
    for (const key of Object.keys(srcObj)) {
      if (!(key in trlObj)) {
        throw new Error(`Missing key "${path ? path + '.' : ''}${key}" in translated output`)
      }
      validateShape(srcObj[key], trlObj[key], path ? `${path}.${key}` : key)
    }
    for (const key of Object.keys(trlObj)) {
      if (!(key in srcObj)) {
        throw new Error(`Extra key "${path ? path + '.' : ''}${key}" in translated output (not in source)`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core translator — calls Haiku, retries on JSON parse failure
// ---------------------------------------------------------------------------

async function translateBlock(
  client: Anthropic,
  source: Record<string, unknown>,
  locale: string,
): Promise<{ result: Record<string, unknown>; usage: { input: number; output: number } }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`  Retry ${attempt}/${MAX_RETRIES} for ${locale}...`)
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(source, locale) }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      lastError = new Error('Claude response contained no text block')
      continue
    }

    const raw = textBlock.text.trim()

    // Strip markdown code fences if present
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(stripped)
    } catch (e) {
      lastError = new Error(`JSON parse error: ${(e as Error).message}. Raw (first 300 chars): ${stripped.slice(0, 300)}`)
      continue
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (obj.TRANSLATION_FAILED) {
        lastError = new Error('Claude returned TRANSLATION_FAILED sentinel')
        continue
      }

      // Validate shape matches source
      try {
        validateShape(source, obj)
      } catch (e) {
        lastError = e as Error
        continue
      }

      return {
        result: obj,
        usage: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
        },
      }
    }

    lastError = new Error('Response is not a plain JSON object')
  }

  throw lastError ?? new Error('Unknown error')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Load .env.local manually (tsx doesn't auto-load it)
  const envLocalPath = path.resolve(__dirname, '../.env.local')
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('BLOCKED: ANTHROPIC_API_KEY is not set.')
    process.exit(1)
  }

  // Read source English namespace
  const enPath = path.join(MESSAGES_DIR, 'en.json')
  const enFile = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, unknown>
  const sourceBlock = enFile.roadToOlympics as Record<string, unknown>
  if (!sourceBlock) {
    console.error('ERROR: roadToOlympics key not found in en.json')
    process.exit(1)
  }

  console.log(`Source block loaded — ${Object.keys(sourceBlock).length} top-level keys`)
  console.log()

  const client = new Anthropic({ apiKey })

  let totalInput = 0
  let totalOutput = 0
  const failures: string[] = []

  for (const locale of ['es', 'pt', 'it', 'fr']) {
    const t0 = Date.now()
    console.log(`Translating to ${locale} (${LOCALE_LABEL[locale]})...`)

    try {
      const { result, usage } = await translateBlock(client, sourceBlock, locale)

      // Read the current locale file
      const localePath = path.join(MESSAGES_DIR, `${locale}.json`)
      const localeFile = JSON.parse(fs.readFileSync(localePath, 'utf8')) as Record<string, unknown>

      // Replace only the roadToOlympics block
      localeFile.roadToOlympics = result

      // Write back — JSON.stringify preserves key order from the parsed object
      fs.writeFileSync(localePath, JSON.stringify(localeFile, null, 2) + '\n', 'utf8')

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      totalInput += usage.input
      totalOutput += usage.output
      console.log(
        `  Done in ${elapsed}s — input tokens: ${usage.input}, output tokens: ${usage.output}`,
      )
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.error(`  FAILED after ${elapsed}s: ${(err as Error).message}`)
      failures.push(locale)
    }

    console.log()
  }

  console.log(`Total tokens: ${totalInput} input + ${totalOutput} output = ${totalInput + totalOutput} total`)
  console.log()

  if (failures.length > 0) {
    console.warn(`Skipped locales (English fallback kept): ${failures.join(', ')}`)
  } else {
    console.log('All locales translated successfully.')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
