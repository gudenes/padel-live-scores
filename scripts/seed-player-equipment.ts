// scripts/seed-player-equipment.ts
//
// One-time seed: populate equipment JSONB for top 20 men + top 20 women.
// Run: npx tsx scripts/seed-player-equipment.ts
//
// Sources: esprit-padel-shop.com 2026 player racket list,
// manufacturer product pages, Premier Padel broadcast data.

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

interface EquipmentEntry {
  /** Player name (used for fuzzy matching against DB) */
  name: string
  equipment: {
    racket_brand: string
    racket_model: string
    racket_url?: string
  }
}

// ── Top men (2026 rankings) ─────────────────────────────────────
const MEN: EquipmentEntry[] = [
  { name: 'Arturo Coello', equipment: { racket_brand: 'HEAD', racket_model: 'Coello Pro 2025' } },
  { name: 'Agustin Tapia', equipment: { racket_brand: 'Nox', racket_model: 'AT10 Genius 12K 2026' } },
  { name: 'Federico Chingotto', equipment: { racket_brand: 'Bullpadel', racket_model: 'Neuron 02 2026' } },
  { name: 'Alejandro Galan', equipment: { racket_brand: 'Adidas', racket_model: 'Metalbone HRD+ 3.5 2026' } },
  { name: 'Franco Stupaczuk', equipment: { racket_brand: 'Siux', racket_model: 'Electra ST5 Stupa Pro Noir 2026' } },
  { name: 'Juan Lebron', equipment: { racket_brand: 'Babolat', racket_model: 'Viper Juan Lebron 3.0 2026' } },
  { name: 'Jorge Nieto', equipment: { racket_brand: 'Babolat', racket_model: 'Counter Viper 2.5 2025' } },
  { name: 'Miguel Yanguas', equipment: { racket_brand: 'Lok', racket_model: 'Maxx Hype Gen 2 2026' } },
  { name: 'Paquito Navarro', equipment: { racket_brand: 'Bullpadel', racket_model: 'Hack 04 Hybrid 2026' } },
  { name: 'Leandro Augsburger', equipment: { racket_brand: 'Siux', racket_model: 'Fenix Pro VI Black Edition 2026' } },
  { name: 'Jon Sanz', equipment: { racket_brand: 'HEAD', racket_model: 'Speed Motion 2026' } },
  { name: 'Momo Gonzalez', equipment: { racket_brand: 'Bullpadel', racket_model: 'Vertex 04 2026' } },
  { name: 'Martin Di Nenno', equipment: { racket_brand: 'Adidas', racket_model: 'Metalbone 3.3 2026' } },
  { name: 'Francisco Navarro', equipment: { racket_brand: 'Bullpadel', racket_model: 'Hack 04 2026' } },
  { name: 'Fernando Belasteguin', equipment: { racket_brand: 'Wilson', racket_model: 'Bela Pro V2 2026' } },
  { name: 'Javier Garrido', equipment: { racket_brand: 'Babolat', racket_model: 'Technical Viper 2026' } },
  { name: 'Lucas Bergamini', equipment: { racket_brand: 'Nox', racket_model: 'ML10 Pro Cup 2026' } },
  { name: 'Coki Nieto', equipment: { racket_brand: 'Babolat', racket_model: 'Counter Viper 3.0 2026' } },
  { name: 'Alex Ruiz', equipment: { racket_brand: 'StarVie', racket_model: 'Aquila Carbon Pro 2026' } },
  { name: 'Javier Barahona', equipment: { racket_brand: 'HEAD', racket_model: 'Extreme Motion 2026' } },
]

// ── Top women (2026 rankings) ────────────────────────────────────
const WOMEN: EquipmentEntry[] = [
  { name: 'Delfina Brea', equipment: { racket_brand: 'Bullpadel', racket_model: 'Vertex 05 Woman 2026' } },
  { name: 'Gemma Triay', equipment: { racket_brand: 'Bullpadel', racket_model: 'Elite Woman 2026' } },
  { name: 'Ariana Sanchez', equipment: { racket_brand: 'HEAD', racket_model: 'Speed Motion 2025' } },
  { name: 'Paula Josemaria', equipment: { racket_brand: 'HEAD', racket_model: 'Extreme Motion 2025' } },
  { name: 'Claudia Fernandez', equipment: { racket_brand: 'Bullpadel', racket_model: 'Wonder 2026' } },
  { name: 'Beatriz Gonzalez', equipment: { racket_brand: 'Bullpadel', racket_model: 'Pearl 2026' } },
  { name: 'Sofia Araujo', equipment: { racket_brand: 'Siux', racket_model: 'Valkiria Pro 2026' } },
  { name: 'Andrea Ustero', equipment: { racket_brand: 'HEAD', racket_model: 'Gravity Motion' } },
  { name: 'Marta Ortega', equipment: { racket_brand: 'Adidas', racket_model: 'Cross It Light 3.5 2026' } },
  { name: 'Tamara Icardo', equipment: { racket_brand: 'StarVie', racket_model: 'Triton Balance + 2026' } },
  { name: 'Alejandra Salazar', equipment: { racket_brand: 'Bullpadel', racket_model: 'Flow 2026' } },
  { name: 'Ari Sanchez', equipment: { racket_brand: 'HEAD', racket_model: 'Speed Motion 2025' } },
  { name: 'Lucia Sainz', equipment: { racket_brand: 'Nox', racket_model: 'ML10 Pro Cup Woman 2026' } },
  { name: 'Marta Marrero', equipment: { racket_brand: 'Bullpadel', racket_model: 'Hack 04 Woman 2026' } },
  { name: 'Patty Llaguno', equipment: { racket_brand: 'Babolat', racket_model: 'Viper Air 2026' } },
  { name: 'Delfi Brea', equipment: { racket_brand: 'Bullpadel', racket_model: 'Vertex 05 Woman 2026' } },
  { name: 'Virginia Riera', equipment: { racket_brand: 'StarVie', racket_model: 'Metheora Warrior 2026' } },
  { name: 'Jessica Castello', equipment: { racket_brand: 'Nox', racket_model: 'AT Luxury 2026' } },
  { name: 'Lorena Rufo', equipment: { racket_brand: 'Bullpadel', racket_model: 'Vertex 04 Woman 2026' } },
  { name: 'Alix Collombon', equipment: { racket_brand: 'Babolat', racket_model: 'Viper Counter Woman 2026' } },
]

async function matchAndUpdate(entries: EquipmentEntry[], label: string) {
  let matched = 0
  let missed = 0

  for (const entry of entries) {
    // Try exact name match first
    const { data } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', `%${entry.name}%`)
      .limit(1)

    if (data && data.length > 0) {
      const player = data[0]
      const { error } = await supabase
        .from('players')
        .update({ equipment: entry.equipment })
        .eq('id', player.id)

      if (error) {
        console.error(`  ✗ ${entry.name} → update failed: ${error.message}`)
        missed++
      } else {
        console.log(`  ✓ ${entry.name} → ${player.name} (${entry.equipment.racket_brand} ${entry.equipment.racket_model})`)
        matched++
      }
    } else {
      console.warn(`  ? ${entry.name} → not found in DB`)
      missed++
    }
  }

  console.log(`\n${label}: ${matched} matched, ${missed} missed`)
  return { matched, missed }
}

async function main() {
  console.log('=== Seeding Player Equipment ===\n')

  console.log('--- Men ---')
  const men = await matchAndUpdate(MEN, 'Men')

  console.log('\n--- Women ---')
  const women = await matchAndUpdate(WOMEN, 'Women')

  console.log(`\n=== Done: ${men.matched + women.matched} players updated, ${men.missed + women.missed} missed ===`)
}

main().catch(console.error)
