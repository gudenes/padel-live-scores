// scripts/fetch-equipment-images.ts
//
// Fetches product images for rackets from padel retailer sites
// and brand logos from Wikipedia/brand sites.
// Updates padel_rackets.image_url and padel_brands.logo_url.
//
// Run: npx tsx scripts/fetch-equipment-images.ts
//
// Strategy: For each racket without an image, try known retailer
// product page patterns to find the og:image or product image.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
} catch {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Brand logos (manually verified, reliable CDN/Wikipedia URLs) ──
const BRAND_LOGOS: Record<string, string[]> = {
  'HEAD': [
    'https://cdn.brandfetch.io/head.com/w/400/h/400/logo',
    'https://www.head.com/on/demandware.static/Sites-head-master-catalog/default/dw5ec4e06f/images/logo/HEAD_Logo.svg',
  ],
  'Bullpadel': [
    'https://cdn.brandfetch.io/bullpadel.com/w/400/h/400/logo',
  ],
  'Nox': [
    'https://cdn.brandfetch.io/noxpadel.com/w/400/h/400/logo',
  ],
  'Babolat': [
    'https://cdn.brandfetch.io/babolat.com/w/400/h/400/logo',
  ],
  'Adidas': [
    'https://cdn.brandfetch.io/adidas.com/w/400/h/400/logo',
  ],
  'Siux': [
    'https://cdn.brandfetch.io/siux.com/w/400/h/400/logo',
  ],
  'Wilson': [
    'https://cdn.brandfetch.io/wilson.com/w/400/h/400/logo',
  ],
  'StarVie': [
    'https://cdn.brandfetch.io/starvie.com/w/400/h/400/logo',
  ],
  'Lok': [],
}

// ── Fetch a URL and extract og:image or product image ────────────
async function fetchProductImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()

    // Try og:image first (most reliable for product pages)
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
    if (ogMatch?.[1]) {
      const imgUrl = ogMatch[1]
      // Skip placeholder/generic images
      if (!imgUrl.includes('placeholder') && !imgUrl.includes('no-image')) {
        return imgUrl
      }
    }

    return null
  } catch {
    return null
  }
}

// ── Build search URLs for a racket across multiple retailers ─────
function buildSearchUrls(brand: string, model: string, year: number | null): string[] {
  const fullName = `${brand} ${model}${year ? ` ${year}` : ''}`
  const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
  const searchSlug = encodeURIComponent(fullName.toLowerCase())

  return [
    // PadelUSA (Shopify — good product images)
    `https://padelusa.com/search?q=${searchSlug}&type=product`,
    // Padel Nuestro (large catalog)
    `https://www.padelnuestro.com/catalogsearch/result/?q=${searchSlug}`,
    // Smashinn
    `https://www.tradeinn.com/smashinn/en?q=${searchSlug}`,
  ]
}

// ── Try to find product page from search results ─────────────────
async function findProductPage(brand: string, model: string, year: number | null): Promise<string | null> {
  const fullName = `${brand} ${model}${year ? ` ${year}` : ''}`
  const slug = fullName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '')

  // Try direct PadelUSA product URL patterns
  const padelusaUrls = [
    `https://padelusa.com/products/${slug}-padel-racket`,
    `https://padelusa.com/products/${slug}`,
    `https://padelusa.com/products/${slug.replace(/-\d{4}$/, '')}-padel-racket`,
  ]

  for (const url of padelusaUrls) {
    const img = await fetchProductImage(url)
    if (img) return img
  }

  return null
}

// ── Verify image URL ─────────────────────────────────────────────
async function isImageValid(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    const ct = res.headers.get('content-type') ?? ''
    return res.ok && (ct.startsWith('image/') || ct.includes('webp'))
  } catch {
    return false
  }
}

async function main() {
  console.log('=== Fetching Equipment Images ===\n')

  // ── 1. Update brand logos ──────────────────────────────────────
  console.log('--- Brand Logos ---')
  const { data: brands } = await supabase.from('padel_brands').select('id, name, logo_url')
  let brandUpdated = 0

  for (const brand of brands ?? []) {
    if (brand.logo_url) {
      console.log(`  ✓ ${brand.name}: already has logo`)
      continue
    }

    const candidates = BRAND_LOGOS[brand.name] ?? []
    let found = false
    for (const logoUrl of candidates) {
      const valid = await isImageValid(logoUrl)
      if (valid) {
        await supabase.from('padel_brands').update({ logo_url: logoUrl }).eq('id', brand.id)
        console.log(`  🏷️  ${brand.name}: logo set ✓`)
        brandUpdated++
        found = true
        break
      }
    }
    if (!found && candidates.length > 0) {
      console.log(`  ⚠ ${brand.name}: no accessible logo URL`)
    } else if (!found) {
      console.log(`  ? ${brand.name}: no known logo`)
    }
  }

  console.log(`\nBrand logos updated: ${brandUpdated}\n`)

  // ── 2. Search for racket images ────────────────────────────────
  console.log('--- Racket Images ---')
  const { data: rackets } = await supabase
    .from('padel_rackets')
    .select('id, model, year, image_url, brand:padel_brands(name)')

  let racketUpdated = 0
  let racketSkipped = 0
  let racketFailed = 0

  for (const racket of rackets ?? []) {
    if (racket.image_url) {
      console.log(`  ✓ ${(racket.brand as any)?.name} ${racket.model}: already has image`)
      racketSkipped++
      continue
    }

    const brandName = (racket.brand as any)?.name ?? ''
    console.log(`  🔍 ${brandName} ${racket.model} ${racket.year ?? ''}...`)

    const imageUrl = await findProductPage(brandName, racket.model, racket.year)

    if (imageUrl) {
      await supabase.from('padel_rackets').update({ image_url: imageUrl }).eq('id', racket.id)
      console.log(`    ✅ ${imageUrl.substring(0, 80)}...`)
      racketUpdated++
    } else {
      console.log(`    ❌ No image found`)
      racketFailed++
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`\n=== Summary ===`)
  console.log(`Brand logos: ${brandUpdated} updated`)
  console.log(`Racket images: ${racketUpdated} found, ${racketSkipped} already had images, ${racketFailed} not found`)
  console.log(`\nTip: For rackets without images, add them manually via the ops dashboard`)
  console.log(`     Brands & Equipment tab → Edit racket → paste Image URL`)
}

main().catch(console.error)
