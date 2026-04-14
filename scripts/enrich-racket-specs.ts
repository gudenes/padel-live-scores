#!/usr/bin/env npx tsx
/**
 * Enrich racket specs (shape, weight, balance, image, product URL) using
 * web search + Claude extraction.
 *
 * Usage:
 *   npx tsx scripts/enrich-racket-specs.ts [--dry-run] [--limit N] [--model "Exact Model"]
 *
 * Requires: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const FIELDS_TO_ENRICH = ['shape', 'weight_grams', 'balance'] as const

interface RacketSpecs {
  shape: string | null        // 'diamond' | 'round' | 'teardrop' | 'hybrid'
  weight_grams: number | null // e.g. 365
  balance: string | null      // 'head-heavy' | 'balanced' | 'head-light'
  image_url: string | null    // product image URL
  product_url: string | null  // link to buy / product page
}

async function searchAndExtractWithClaude(
  anthropic: Anthropic,
  brand: string,
  model: string,
  year: number | null,
): Promise<RacketSpecs> {
  const query = `${brand} ${model} ${year ?? ''} padel racket specifications shape weight balance`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305' as any, name: 'web_search', max_uses: 3 }] as any,
    messages: [
      {
        role: 'user',
        content: `Search the web for specs of the padel racket "${brand} ${model}${year ? ` ${year}` : ''}".

I need:
1. **shape**: one of "diamond", "round", "teardrop", or "hybrid"
2. **weight_grams**: numeric weight in grams (e.g. 365)
3. **balance**: one of "head-heavy", "balanced", or "head-light"
4. **image_url**: a direct URL to a product image (jpg/png/webp)
5. **product_url**: best product/shop page URL

Respond ONLY with a JSON object. Use null for fields you can't determine.
Example: {"shape":"diamond","weight_grams":365,"balance":"head-heavy","image_url":"https://...","product_url":"https://..."}`,
      },
    ],
  })

  // Extract text from response (may have multiple content blocks due to tool use)
  let text = ''
  for (const block of response.content) {
    if (block.type === 'text') text += block.text
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { shape: null, weight_grams: null, balance: null, image_url: null, product_url: null }
    const parsed = JSON.parse(jsonMatch[0])
    return {
      shape: ['diamond', 'round', 'teardrop', 'hybrid'].includes(parsed.shape) ? parsed.shape : null,
      weight_grams: typeof parsed.weight_grams === 'number' && parsed.weight_grams > 200 && parsed.weight_grams < 500 ? parsed.weight_grams : null,
      balance: ['head-heavy', 'balanced', 'head-light'].includes(parsed.balance) ? parsed.balance : null,
      image_url: typeof parsed.image_url === 'string' && parsed.image_url.startsWith('http') ? parsed.image_url : null,
      product_url: typeof parsed.product_url === 'string' && parsed.product_url.startsWith('http') ? parsed.product_url : null,
    }
  } catch {
    console.log(`  ⚠ Failed to parse response: ${text.slice(0, 200)}`)
    return { shape: null, weight_grams: null, balance: null, image_url: null, product_url: null }
  }
}


async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const limitIdx = process.argv.indexOf('--limit')
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : 999
  const modelIdx = process.argv.indexOf('--model')
  const filterModel = modelIdx !== -1 ? process.argv[modelIdx + 1] : null

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const anthropic = new Anthropic()

  let query = supabase
    .from('padel_rackets')
    .select('id, model, year, shape, weight_grams, balance, image_url, product_url, brand:padel_brands(name)')
    .order('model')

  if (filterModel) {
    query = query.ilike('model', `%${filterModel}%`)
  }

  const { data: rackets, error } = await query

  if (error || !rackets) {
    console.error('Failed to fetch rackets:', error)
    process.exit(1)
  }

  // Filter to rackets missing at least one spec field
  const needsEnrichment = rackets.filter(r =>
    !r.shape || !r.weight_grams || !r.balance || !r.image_url || !r.product_url
  )

  console.log(`Found ${needsEnrichment.length} rackets needing enrichment (of ${rackets.length} total)`)
  if (limit < needsEnrichment.length) console.log(`Processing first ${limit}`)
  console.log('')

  let enriched = 0
  let failed = 0

  for (const racket of needsEnrichment.slice(0, limit)) {
    const brand = (racket.brand as any)?.name ?? 'Unknown'
    const label = `${brand} ${racket.model} ${racket.year ?? ''}`
    console.log(`→ ${label}`)

    // Search web + extract specs with Claude
    console.log(`  Searching & extracting with Claude...`)
    const specs = await searchAndExtractWithClaude(anthropic, brand, racket.model, racket.year)

    // Only update fields that are currently null in DB
    const updates: Record<string, unknown> = {}
    if (!racket.shape && specs.shape) updates.shape = specs.shape
    if (!racket.weight_grams && specs.weight_grams) updates.weight_grams = specs.weight_grams
    if (!racket.balance && specs.balance) updates.balance = specs.balance
    if (!racket.image_url && specs.image_url) updates.image_url = specs.image_url
    if (!racket.product_url && specs.product_url) updates.product_url = specs.product_url

    if (Object.keys(updates).length === 0) {
      console.log(`  – No new data extracted`)
      failed++
      continue
    }

    console.log(`  Specs: ${JSON.stringify(updates)}`)

    if (dryRun) {
      console.log(`  [dry-run] Would update ${Object.keys(updates).length} fields`)
      enriched++
      continue
    }

    const { error: updateError } = await supabase
      .from('padel_rackets')
      .update(updates)
      .eq('id', racket.id)

    if (updateError) {
      console.log(`  ✗ Update failed: ${updateError.message}`)
      failed++
    } else {
      console.log(`  ✓ Updated ${Object.keys(updates).length} fields`)
      enriched++
    }

    // Rate limit: 1 second between rackets
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\nDone: ${enriched} enriched, ${failed} failed${dryRun ? ' (dry-run)' : ''}`)
}

main()
