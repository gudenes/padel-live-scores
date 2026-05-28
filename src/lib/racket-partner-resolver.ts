// src/lib/racket-partner-resolver.ts
// Resolves the destination URL for a racket "Learn more" click,
// given the user's country and any active partner for that country.
//
// Pure function (no DB). The DB helper below fetches a partner row by country.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface Partner {
  id: string
  name: string
  country_code: string
  fallback_url: string
}

export type ResolvedKind = 'per_racket' | 'partner_fallback' | 'original'

export interface ResolveInput {
  country: string | null
  partner: Partner | null
  perRacketUrl: string | null
  originalProductUrl: string | null
}

export interface ResolveOutput {
  url: string | null
  partnerId: string | null
  resolvedKind: ResolvedKind
}

export function resolveRacketDestination(input: ResolveInput): ResolveOutput {
  const { country, partner, perRacketUrl, originalProductUrl } = input

  if (partner && country && partner.country_code === country) {
    if (perRacketUrl) {
      return { url: perRacketUrl, partnerId: partner.id, resolvedKind: 'per_racket' }
    }
    return { url: partner.fallback_url, partnerId: partner.id, resolvedKind: 'partner_fallback' }
  }

  return { url: originalProductUrl, partnerId: null, resolvedKind: 'original' }
}

// DB helper — fetches the active partner row for a country, or null.
// Returns null on any error so callers fall through to original product URL.
export async function getActivePartnerForCountry(
  supabase: SupabaseClient,
  country: string | null,
): Promise<Partner | null> {
  if (!country) return null
  const { data, error } = await supabase
    .from('partners')
    .select('id, name, country_code, fallback_url')
    .eq('country_code', country)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return data as Partner
}

// DB helper — fetches the per-racket override URL for a (racket, partner) pair.
export async function getPerRacketUrl(
  supabase: SupabaseClient,
  racketId: string,
  partnerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('racket_partner_links')
    .select('url')
    .eq('racket_id', racketId)
    .eq('partner_id', partnerId)
    .maybeSingle()
  if (error || !data) return null
  return (data.url as string) ?? null
}
