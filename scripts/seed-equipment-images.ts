// scripts/seed-equipment-images.ts
//
// Updates equipment JSONB with brand_logo and racket_image URLs
// for players who already have equipment data.
// Run: npx tsx scripts/seed-equipment-images.ts
//
// Brand logos sourced from brandfetch/seeklogo CDNs.
// Racket images sourced from padelreference.com product pages.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const [, key, value] = match
      process.env[key.trim()] = value.trim()
    }
  }
} catch { /* fallback to existing env */ }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Brand logos (white-on-transparent or clean logos) ─────────────
// Using stable CDN URLs from logo databases
const BRAND_LOGOS: Record<string, string> = {
  'HEAD': 'https://seeklogo.com/images/H/head-logo-2CFA2C2D2E-seeklogo.com.png',
  'Bullpadel': 'https://seeklogo.com/images/B/bullpadel-logo-3D6E9C8D4E-seeklogo.com.png',
  'Nox': 'https://seeklogo.com/images/N/nox-padel-logo-B3E5E9C8D4-seeklogo.com.png',
  'Babolat': 'https://seeklogo.com/images/B/babolat-logo-A5E98ECA5E-seeklogo.com.png',
  'Adidas': 'https://seeklogo.com/images/A/adidas-logo-107B082DA0-seeklogo.com.png',
  'Siux': 'https://cdn.brandfetch.io/siux.com/w/512/h/512/logo',
  'Wilson': 'https://seeklogo.com/images/W/wilson-sporting-goods-logo-2A0BDB1E8A-seeklogo.com.png',
  'StarVie': 'https://cdn.brandfetch.io/starvie.com/w/512/h/512/logo',
  'Lok': '', // Smaller brand — no reliable logo CDN
}

// ── Racket images from product pages ─────────────────────────────
// Sourced from padelreference.com, padelusa.com, and manufacturer sites
// These are direct product image URLs
const RACKET_IMAGES: Record<string, string> = {
  // Men
  'HEAD Coello Pro 2025': 'https://www.padelreference.com/storage/padel-rackets/head-coello-pro-2025.png',
  'Nox AT10 Genius 12K 2026': 'https://www.padelreference.com/storage/padel-rackets/nox-at10-genius-12k-2026.png',
  'Bullpadel Neuron 02 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-neuron-02-2026.png',
  'Adidas Metalbone HRD+ 3.5 2026': 'https://www.padelreference.com/storage/padel-rackets/adidas-metalbone-hrd-35-2026.png',
  'Siux Electra ST5 Stupa Pro Noir 2026': 'https://www.padelreference.com/storage/padel-rackets/siux-electra-st5-stupa-pro-noir-2026.png',
  'Babolat Viper Juan Lebron 3.0 2026': 'https://www.padelreference.com/storage/padel-rackets/babolat-viper-juan-lebron-30-2026.png',
  'Babolat Counter Viper 2.5 2025': 'https://www.padelreference.com/storage/padel-rackets/babolat-counter-viper-25-2025.png',
  'Lok Maxx Hype Gen 2 2026': '',
  'Bullpadel Hack 04 Hybrid 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-hack-04-hybrid-2026.png',
  'Siux Fenix Pro VI Black Edition 2026': 'https://www.padelreference.com/storage/padel-rackets/siux-fenix-pro-vi-black-edition-2026.png',
  'HEAD Speed Motion 2026': 'https://www.padelreference.com/storage/padel-rackets/head-speed-motion-2026.png',
  'Bullpadel Vertex 04 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-vertex-04-2026.png',
  'Adidas Metalbone 3.3 2026': 'https://www.padelreference.com/storage/padel-rackets/adidas-metalbone-33-2026.png',
  'Bullpadel Hack 04 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-hack-04-2026.png',
  'Wilson Bela Pro V2 2026': 'https://www.padelreference.com/storage/padel-rackets/wilson-bela-pro-v2-2026.png',
  'Babolat Technical Viper 2026': 'https://www.padelreference.com/storage/padel-rackets/babolat-technical-viper-2026.png',
  'Nox ML10 Pro Cup 2026': 'https://www.padelreference.com/storage/padel-rackets/nox-ml10-pro-cup-2026.png',
  'StarVie Aquila Carbon Pro 2026': 'https://www.padelreference.com/storage/padel-rackets/starvie-aquila-carbon-pro-2026.png',
  'HEAD Extreme Motion 2026': 'https://www.padelreference.com/storage/padel-rackets/head-extreme-motion-2026.png',
  // Women
  'Bullpadel Vertex 05 Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-vertex-05-woman-2026.png',
  'Bullpadel Elite Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-elite-woman-2026.png',
  'HEAD Speed Motion 2025': 'https://www.padelreference.com/storage/padel-rackets/head-speed-motion-2025.png',
  'HEAD Extreme Motion 2025': 'https://www.padelreference.com/storage/padel-rackets/head-extreme-motion-2025.png',
  'Bullpadel Wonder 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-wonder-2026.png',
  'Bullpadel Pearl 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-pearl-2026.png',
  'Siux Valkiria Pro 2026': 'https://www.padelreference.com/storage/padel-rackets/siux-valkiria-pro-2026.png',
  'HEAD Gravity Motion': 'https://www.padelreference.com/storage/padel-rackets/head-gravity-motion.png',
  'Adidas Cross It Light 3.5 2026': 'https://www.padelreference.com/storage/padel-rackets/adidas-cross-it-light-35-2026.png',
  'StarVie Triton Balance + 2026': 'https://www.padelreference.com/storage/padel-rackets/starvie-triton-balance-plus-2026.png',
  'Bullpadel Flow 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-flow-2026.png',
  'Nox ML10 Pro Cup Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/nox-ml10-pro-cup-woman-2026.png',
  'Bullpadel Hack 04 Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-hack-04-woman-2026.png',
  'Babolat Viper Air 2026': 'https://www.padelreference.com/storage/padel-rackets/babolat-viper-air-2026.png',
  'StarVie Metheora Warrior 2026': 'https://www.padelreference.com/storage/padel-rackets/starvie-metheora-warrior-2026.png',
  'Nox AT Luxury 2026': 'https://www.padelreference.com/storage/padel-rackets/nox-at-luxury-2026.png',
  'Bullpadel Vertex 04 Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/bullpadel-vertex-04-woman-2026.png',
  'Babolat Viper Counter Woman 2026': 'https://www.padelreference.com/storage/padel-rackets/babolat-viper-counter-woman-2026.png',
}

// ── Check if a URL returns a valid image (200 status) ────────────
async function isImageAccessible(url: string): Promise<boolean> {
  if (!url) return false
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  console.log('=== Updating Equipment Images ===\n')

  // Fetch all players with equipment data
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, equipment')
    .not('equipment', 'is', null)

  if (error) {
    console.error('Failed to fetch players:', error.message)
    return
  }

  console.log(`Found ${players?.length ?? 0} players with equipment data\n`)

  let updated = 0
  let skipped = 0
  let logoChecked = 0
  let imageChecked = 0

  for (const player of players ?? []) {
    const eq = player.equipment as Record<string, string>
    if (!eq?.racket_brand) continue

    const brand = eq.racket_brand
    const model = eq.racket_model ?? ''
    const fullModel = `${brand} ${model}`

    let brandLogo = eq.brand_logo ?? ''
    let racketImage = eq.racket_image ?? ''
    let changed = false

    // Add brand logo if missing
    if (!brandLogo && BRAND_LOGOS[brand]) {
      const logoUrl = BRAND_LOGOS[brand]
      logoChecked++
      const accessible = await isImageAccessible(logoUrl)
      if (accessible) {
        brandLogo = logoUrl
        changed = true
        console.log(`  🏷️  ${player.name}: brand logo → ${brand}`)
      } else {
        console.log(`  ⚠️  ${player.name}: brand logo URL not accessible (${brand})`)
      }
    }

    // Add racket image if missing
    if (!racketImage && RACKET_IMAGES[model]) {
      const imageUrl = RACKET_IMAGES[model]
      if (imageUrl) {
        imageChecked++
        const accessible = await isImageAccessible(imageUrl)
        if (accessible) {
          racketImage = imageUrl
          changed = true
          console.log(`  🎾 ${player.name}: racket image → ${model}`)
        } else {
          console.log(`  ⚠️  ${player.name}: racket image URL not accessible (${model})`)
        }
      }
    }

    // Also try full model name match
    if (!racketImage && RACKET_IMAGES[fullModel]) {
      const imageUrl = RACKET_IMAGES[fullModel]
      if (imageUrl) {
        imageChecked++
        const accessible = await isImageAccessible(imageUrl)
        if (accessible) {
          racketImage = imageUrl
          changed = true
          console.log(`  🎾 ${player.name}: racket image → ${fullModel}`)
        } else {
          console.log(`  ⚠️  ${player.name}: racket image URL not accessible (${fullModel})`)
        }
      }
    }

    if (changed) {
      const updatedEquipment = {
        ...eq,
        ...(brandLogo ? { brand_logo: brandLogo } : {}),
        ...(racketImage ? { racket_image: racketImage } : {}),
      }

      const { error: updateError } = await supabase
        .from('players')
        .update({ equipment: updatedEquipment })
        .eq('id', player.id)

      if (updateError) {
        console.error(`  ✗ ${player.name}: update failed — ${updateError.message}`)
      } else {
        updated++
      }
    } else {
      skipped++
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Updated: ${updated} players`)
  console.log(`Skipped: ${skipped} (already had images or no URL available)`)
  console.log(`Logo URLs checked: ${logoChecked}`)
  console.log(`Image URLs checked: ${imageChecked}`)
}

main().catch(console.error)
