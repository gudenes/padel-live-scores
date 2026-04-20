import { describe, it, expect } from 'vitest';
import { createSupabaseClient } from '../lib/supabase.js';

describe('createSupabaseClient', () => {
  it('returns a Supabase client configured with service-role key', () => {
    const client = createSupabaseClient({
      url: 'https://example.supabase.co',
      serviceKey: 'fake-service-key',
    });
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('throws when url is missing', () => {
    expect(() =>
      createSupabaseClient({ url: '', serviceKey: 'k' })
    ).toThrow(/url/i);
  });

  it('throws when serviceKey is missing', () => {
    expect(() =>
      createSupabaseClient({ url: 'https://x.supabase.co', serviceKey: '' })
    ).toThrow(/service.*key/i);
  });
});
