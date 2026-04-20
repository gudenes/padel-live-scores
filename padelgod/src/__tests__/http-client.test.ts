import { describe, it, expect, vi } from 'vitest';
import { createHttpClient } from '../lib/http-client.js';

describe('createHttpClient', () => {
  it('returns an axios instance with the configured User-Agent', () => {
    const client = createHttpClient({ userAgent: 'Padelgod-Test/1.0' });
    expect(client.defaults.headers['User-Agent']).toBe('Padelgod-Test/1.0');
  });

  it('honors a custom timeout', () => {
    const client = createHttpClient({ userAgent: 'X', timeoutMs: 15000 });
    expect(client.defaults.timeout).toBe(15000);
  });

  it('throws when userAgent is empty', () => {
    expect(() => createHttpClient({ userAgent: '' })).toThrow(/userAgent/);
  });
});
