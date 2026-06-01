import { describe, it, expect } from 'vitest';
import { storageKeyFor } from '../avatar-rehost.js';

describe('storageKeyFor', () => {
  it('builds the avatar key with no suffix', () => {
    expect(storageKeyFor('abc-123', '', 'png')).toBe('abc-123.png');
  });
  it('builds the high-res photo key with the -full suffix', () => {
    expect(storageKeyFor('abc-123', '-full', 'jpg')).toBe('abc-123-full.jpg');
  });
});
