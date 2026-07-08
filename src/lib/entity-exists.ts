// src/lib/entity-exists.ts
//
// Orphan-page guard helper. Detail-route layouts call this to decide whether
// to render a 404 for an entity id that no longer exists (e.g. after a
// tournament/player merge or hard-delete).
//
// Tri-state return — callers MUST fail open on `null`:
//   true   → row exists, render normally
//   false  → row definitively absent (or an un-storable id) → notFound()
//   null   → existence could not be determined (DB/transport error) →
//            render children, never 404 the whole site over a Supabase blip
import type { SupabaseClient } from '@supabase/supabase-js'

// Postgres error codes that mean "this id can never identify a row" — treat
// as definitively absent so malformed ids 404 instead of failing open to a
// blank shell. 22P02 = invalid_text_representation (bad UUID syntax).
const DEFINITELY_ABSENT_CODES = new Set(['22P02'])

export async function rowExistsById(
  // Loosely typed so layouts can pass createServerClient() without generics.
  client: Pick<SupabaseClient, 'from'>,
  table: string,
  id: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await client
      .from(table)
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      const code = (error as { code?: string }).code
      if (code && DEFINITELY_ABSENT_CODES.has(code)) return false
      // Any other error is a real query/transport failure → indeterminate.
      return null
    }

    return data != null
  } catch {
    // Thrown exception (network, client misconfig) → indeterminate.
    return null
  }
}
