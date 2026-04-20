import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';

describe('loadEnv', () => {
  it('parses valid env vars', () => {
    const env = loadEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-key-value',
      PADELGOD_ADMIN_TOKEN: 'admin-token-value',
      NODE_ENV: 'test',
      PORT: '3002',
    });
    expect(env.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.PORT).toBe(3002);
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws when SUPABASE_URL is missing', () => {
    expect(() =>
      loadEnv({
        SUPABASE_SERVICE_KEY: 'k',
        PADELGOD_ADMIN_TOKEN: 't',
      })
    ).toThrow(/SUPABASE_URL/);
  });

  it('coerces PORT to number with default 3002', () => {
    const env = loadEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'k',
      PADELGOD_ADMIN_TOKEN: 't',
    });
    expect(env.PORT).toBe(3002);
  });
});
