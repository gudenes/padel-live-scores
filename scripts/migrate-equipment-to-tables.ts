// scripts/migrate-equipment-to-tables.ts
//
// One-time migration: move equipment JSONB data from players.equipment
// into the relational tables: padel_brands, padel_rackets, player_equipment.
//
// Run: npx tsx scripts/migrate-equipment-to-tables.ts

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (dotenv not installed)
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

interface EquipmentJsonb {
  racket_brand?: string
  racket_model?: string
  racket_url?: string
  racket_image?: string
  brand_logo?: string
}

interface PlayerRow {
  id: string
  name: string
  equipment: EquipmentJsonb
}

function parseYear(model: string): number | null {
  const match = model.match(/\b(20\d{2})\b/)
  return match ? parseInt(match[1]) : null
}

function modelWithoutYear(model: string): string {
  return model.replace(/\s*\b20\d{2}\b\s*/, '').trim()
}

async function main() {
  console.log('=== Migrating Equipment JSONB → Relational Tables ===\n')

  // 1. Fetch all players with equipment data
  const { data: players, error: fetchError } = await supabase
    .from('players')
    .select('id, name, equipment')
    .not('equipment', 'is', null)

  if (fetchError) {
    console.error('Failed to fetch players:', fetchError.message)
    process.exit(1)
  }

  if (!players || players.length === 0) {
    console.log('No players with equipment data found. Nothing to migrate.')
    return
  }

  console.log(`Found ${players.length} players with equipment data.\n`)

  const typedPlayers = players as PlayerRow[]

  // Counters
  let brandsCreated = 0
  let brandsSkipped = 0
  let racketsCreated = 0
  let racketsSkipped = 0
  let assignmentsCreated = 0
  let assignmentsSkipped = 0

  // Brand cache: brand name (lowercase) → brand id
  const brandIdCache = new Map<string, string>()

  // Racket cache: `${brand_id}::${model_without_year}` → racket id
  const racketIdCache = new Map<string, string>()

  // 2. Process each player
  for (const player of typedPlayers) {
    const eq = player.equipment
    if (!eq.racket_brand || !eq.racket_model) {
      console.warn(`  SKIP ${player.name} — missing racket_brand or racket_model in JSONB`)
      continue
    }

    const brandName = eq.racket_brand.trim()
    const brandKey = brandName.toLowerCase()

    // ── 3. Upsert brand ──────────────────────────────────────────
    let brandId = brandIdCache.get(brandKey)

    if (!brandId) {
      // Check if brand already exists
      const { data: existingBrand } = await supabase
        .from('padel_brands')
        .select('id')
        .ilike('name', brandName)
        .limit(1)
        .maybeSingle()

      if (existingBrand) {
        brandId = existingBrand.id
        brandsSkipped++
        console.log(`  brand EXISTS  "${brandName}" → ${brandId}`)
      } else {
        // Insert new brand
        const insertPayload: Record<string, unknown> = { name: brandName }
        if (eq.brand_logo) insertPayload.logo_url = eq.brand_logo

        const { data: newBrand, error: brandError } = await supabase
          .from('padel_brands')
          .insert(insertPayload)
          .select('id')
          .single()

        if (brandError || !newBrand) {
          console.error(`  ERROR inserting brand "${brandName}": ${brandError?.message}`)
          continue
        }

        brandId = newBrand.id
        brandsCreated++
        console.log(`  brand CREATED "${brandName}" → ${brandId}`)
      }

      brandIdCache.set(brandKey, brandId!)
    }

    // ── 4. Upsert racket ─────────────────────────────────────────
    const rawModel = eq.racket_model.trim()
    const modelName = modelWithoutYear(rawModel)
    const year = parseYear(rawModel)
    const racketKey = `${brandId}::${modelName.toLowerCase()}`

    let racketId = racketIdCache.get(racketKey)

    if (!racketId) {
      // Check if racket already exists (brand_id + model, case-insensitive)
      const { data: existingRacket } = await supabase
        .from('padel_rackets')
        .select('id')
        .eq('brand_id', brandId)
        .ilike('model', modelName)
        .limit(1)
        .maybeSingle()

      if (existingRacket) {
        racketId = existingRacket.id
        racketsSkipped++
        console.log(`    racket EXISTS  "${brandName} ${modelName}" → ${racketId}`)
      } else {
        // Insert new racket
        const insertPayload: Record<string, unknown> = {
          brand_id: brandId,
          model: modelName,
        }
        if (year) insertPayload.year = year
        if (eq.racket_image) insertPayload.image_url = eq.racket_image
        if (eq.racket_url) insertPayload.product_url = eq.racket_url

        const { data: newRacket, error: racketError } = await supabase
          .from('padel_rackets')
          .insert(insertPayload)
          .select('id')
          .single()

        if (racketError || !newRacket) {
          console.error(`    ERROR inserting racket "${brandName} ${modelName}": ${racketError?.message}`)
          continue
        }

        racketId = newRacket.id
        racketsCreated++
        console.log(`    racket CREATED "${brandName} ${modelName}" (year=${year ?? 'n/a'}) → ${racketId}`)
      }

      racketIdCache.set(racketKey, racketId!)
    }

    // ── 5. Upsert player_equipment assignment ────────────────────
    const { data: existingAssignment } = await supabase
      .from('player_equipment')
      .select('id')
      .eq('player_id', player.id)
      .eq('racket_id', racketId)
      .is('ended_at', null)
      .limit(1)
      .maybeSingle()

    if (existingAssignment) {
      assignmentsSkipped++
      console.log(`      assignment EXISTS  ${player.name} → racket ${racketId}`)
    } else {
      const { error: assignError } = await supabase
        .from('player_equipment')
        .insert({
          player_id: player.id,
          racket_id: racketId,
          ended_at: null,
        })

      if (assignError) {
        console.error(`      ERROR assigning ${player.name}: ${assignError.message}`)
      } else {
        assignmentsCreated++
        console.log(`      assignment CREATED  ${player.name} → "${brandName} ${rawModel}"`)
      }
    }
  }

  console.log('\n=== Migration Summary ===')
  console.log(`  Brands   — created: ${brandsCreated}, skipped (already existed): ${brandsSkipped}`)
  console.log(`  Rackets  — created: ${racketsCreated}, skipped (already existed): ${racketsSkipped}`)
  console.log(`  Assignments — created: ${assignmentsCreated}, skipped (already existed): ${assignmentsSkipped}`)
  console.log('=== Done ===')
}

main().catch(console.error)
