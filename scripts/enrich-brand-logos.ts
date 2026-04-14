#!/usr/bin/env npx tsx
/**
 * Enrich brand logos from Brandfetch CDN.
 * Usage: npx tsx scripts/enrich-brand-logos.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js'

const BRAND_DOMAINS: Record<string, string> = {
  'Adidas': 'adidas.com',
  'Babolat': 'babolat.com',
  'Bullpadel': 'bullpadel.com',
  'HEAD': 'head.com',
  'Lok': 'lokpadel.com',
  'Nox': 'noxpadel.com',
  'Siux': 'siux.com',
  'StarVie': 'starvie.com',
  'Wilson': 'wilson.com',
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  const { data: brands, error } = await supabase
    .from('padel_brands')
    .select('id, name, logo_url')
    .order('name')

  if (error || !brands) {
    console.error('Failed to fetch brands:', error)
    process.exit(1)
  }

  let updated = 0
  let skipped = 0

  for (const brand of brands) {
    if (brand.logo_url) {
      console.log(`✓ ${brand.name} — already has logo`)
      skipped++
      continue
    }

    const domain = BRAND_DOMAINS[brand.name]
    if (!domain) {
      console.log(`? ${brand.name} — no domain mapping, skipping`)
      skipped++
      continue
    }

    const logoUrl = `https://cdn.brandfetch.io/${domain}/w/512/h/512/logo`

    // Verify the URL resolves
    try {
      const res = await fetch(logoUrl, { method: 'HEAD', redirect: 'follow' })
      if (!res.ok) {
        console.log(`✗ ${brand.name} — Brandfetch returned ${res.status}`)
        continue
      }
    } catch (e) {
      console.log(`✗ ${brand.name} — fetch failed: ${e}`)
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] ${brand.name} → ${logoUrl}`)
      updated++
      continue
    }

    const { error: updateError } = await supabase
      .from('padel_brands')
      .update({ logo_url: logoUrl })
      .eq('id', brand.id)

    if (updateError) {
      console.log(`✗ ${brand.name} — update failed: ${updateError.message}`)
    } else {
      console.log(`✓ ${brand.name} → ${logoUrl}`)
      updated++
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped${dryRun ? ' (dry-run)' : ''}`)
}

main()
