// src/lib/referral.ts
//
// Utilities for generating and resolving user referral codes.
// Codes are 6-character base36 strings (uppercase), e.g. "AB3K9M".
// Collision probability is ~1 in 2.1 billion — retries up to 3 times.

import { supabase } from '@/lib/supabase'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CODE_LENGTH = 6
const MAX_RETRIES = 3

/**
 * Generate a random 6-character base36 referral code using
 * crypto.getRandomValues. Browser-safe and collision-resistant.
 */
export function generateReferralCode(): string {
  const arr = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * Ensure the given user has a referral code. If profiles.referral_code
 * is already set, return it. Otherwise generate one, UPDATE the row,
 * and return the new code. Retries on unique-constraint violation
 * (vanishingly rare).
 *
 * Returns null if the user does not exist or the update fails after
 * all retries.
 */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  // Fast path: read current code
  const { data: existing } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('id', userId)
    .maybeSingle()

  if (existing?.referral_code) return existing.referral_code

  // Generate + upsert, retrying on collision
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateReferralCode()
    const { error } = await supabase
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', userId)
      .is('referral_code', null)

    if (!error) return code
    // Collision on the unique constraint → retry with a fresh code
    if (error.code === '23505') continue
    // Any other error: bail
    console.warn('[referral] ensureReferralCode update failed:', error)
    return null
  }
  console.warn('[referral] ensureReferralCode exhausted retries')
  return null
}

/**
 * Resolve an inviter's public profile fields by referral code.
 * Returns null if no match. Safe to call anonymously (RLS permits).
 */
export async function resolveInviterByCode(code: string): Promise<{
  id: string
  display_name: string | null
  avatar_url: string | null
} | null> {
  if (!code) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('referral_code', code.toUpperCase())
    .maybeSingle()
  return data ?? null
}

/**
 * Count how many users have been referred by the given user.
 * Used to compute the ambassador tier.
 */
export async function countReferralsByUser(userId: string): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', userId)
  return count ?? 0
}
