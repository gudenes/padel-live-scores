import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseClientOptions {
  url: string;
  serviceKey: string;
}

export function createSupabaseClient(opts: SupabaseClientOptions): SupabaseClient {
  if (!opts.url) throw new Error('Supabase url is required');
  if (!opts.serviceKey) throw new Error('Supabase service key is required');
  return createClient(opts.url, opts.serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}
