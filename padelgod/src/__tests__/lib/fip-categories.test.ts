import { describe, it, expect } from 'vitest';
import {
  resolveFipLevel,
  resolvePremierLevel,
} from '../../lib/fip-categories.js';

describe('resolvePremierLevel', () => {
  it('maps Premier WP category IDs to their level codes', () => {
    expect(resolvePremierLevel([24], 'paris-major-2026')).toBe('major');     // FIP-PPT-MAJOR
    expect(resolvePremierLevel([25], 'madrid-p1-2026')).toBe('p1');           // FIP-PPT-P1
    expect(resolvePremierLevel([387], 'newgiza-p2-2026')).toBe('p2');         // FIP-PP-P2
    expect(resolvePremierLevel([306], 'premier-padel-finals-2026')).toBe('finals'); // FIP-PP-MASTER-FINALS
    expect(resolvePremierLevel([18], 'fip-platinum-lyon-2026')).toBe('fip_platinum'); // FIP-TOUR-PLATINUM
  });

  it('returns null for non-Premier categories (Bronze/Silver/Gold)', () => {
    expect(resolvePremierLevel([19], 'fip-gold-andorra-2025')).toBeNull();
    expect(resolvePremierLevel([496], 'fip-silver-madrid-2025')).toBeNull();
    expect(resolvePremierLevel([497], 'fip-bronze-istanbul-2026')).toBeNull();
  });

  it('returns null for empty category list', () => {
    expect(resolvePremierLevel([], 'something-2026')).toBeNull();
  });

  // Lightweight smoke test on the existing `resolveFipLevel` so a regression
  // in our additions doesn't go unnoticed.
  it('keeps resolveFipLevel returning null for Premier-tier (existing behaviour)', () => {
    expect(resolveFipLevel([387], 'newgiza-p2-2026')).toBeNull();
    expect(resolveFipLevel([24], 'paris-major-2026')).toBeNull();
  });
});
