import { describe, expect, it, vi } from 'vitest';
import { normalizeCountry, fipCountryNameToAlpha2 } from '../../lib/country.js';

describe('normalizeCountry', () => {
  it('returns null for null, undefined, and empty strings', () => {
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry('   ')).toBeNull();
  });

  it('passes alpha-2 through upper-cased', () => {
    expect(normalizeCountry('ES')).toBe('ES');
    expect(normalizeCountry('es')).toBe('ES');
    expect(normalizeCountry('  fr  ')).toBe('FR');
  });

  it('maps standard ISO 3166-1 alpha-3 → alpha-2', () => {
    // Iberia + Americas
    expect(normalizeCountry('ESP')).toBe('ES');
    expect(normalizeCountry('ARG')).toBe('AR');
    expect(normalizeCountry('BRA')).toBe('BR');
    expect(normalizeCountry('URY')).toBe('UY');
    // Western Europe
    expect(normalizeCountry('FRA')).toBe('FR');
    expect(normalizeCountry('ITA')).toBe('IT');
    expect(normalizeCountry('BEL')).toBe('BE');
    expect(normalizeCountry('DEU')).toBe('DE');
    expect(normalizeCountry('GBR')).toBe('GB');
    // Eastern Europe
    expect(normalizeCountry('UKR')).toBe('UA');
    expect(normalizeCountry('POL')).toBe('PL');
    // Asia-Pacific
    expect(normalizeCountry('JPN')).toBe('JP');
    expect(normalizeCountry('AUS')).toBe('AU');
  });

  it('maps FIFA-style aliases FIP emits', () => {
    // These are NOT ISO alpha-3 — they're the 3-letter codes the FIP
    // search API sometimes returns for flag images. Regression-critical.
    expect(normalizeCountry('POR')).toBe('PT');
    expect(normalizeCountry('NED')).toBe('NL');
    expect(normalizeCountry('GER')).toBe('DE');
    expect(normalizeCountry('SUI')).toBe('CH');
    expect(normalizeCountry('CRO')).toBe('HR');
    expect(normalizeCountry('RSA')).toBe('ZA');
    expect(normalizeCountry('DEN')).toBe('DK');
    expect(normalizeCountry('GRE')).toBe('GR');
    expect(normalizeCountry('CHI')).toBe('CL');
    expect(normalizeCountry('URU')).toBe('UY');
    expect(normalizeCountry('PAR')).toBe('PY');
    expect(normalizeCountry('CRC')).toBe('CR');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeCountry('esp')).toBe('ES');
    expect(normalizeCountry('Esp')).toBe('ES');
    expect(normalizeCountry('  ESP  ')).toBe('ES');
    expect(normalizeCountry('\tEsp\n')).toBe('ES');
  });

  it('returns null for unknown 3-letter codes (respects CHECK constraint)', () => {
    // DB has a CHECK constraint `country IS NULL OR length = 2`, so
    // pass-through would hard-fail the write. Null is the "unknown"
    // signal — surfaces in ops data-quality views; the warn() in the
    // normalizer flags it in Railway logs for a mapping update.
    expect(normalizeCountry('XYZ')).toBeNull();
    expect(normalizeCountry('zzz')).toBeNull();
  });

  it('maps the previously-missing FIFA aliases (regression from 2026-04-23)', () => {
    // These 11 codes leaked because the initial CC3_TO_CC2 table was
    // incomplete. All verified present in production before this PR.
    expect(normalizeCountry('RUS')).toBe('RU');
    expect(normalizeCountry('INA')).toBe('ID');
    expect(normalizeCountry('SIN')).toBe('SG');
    expect(normalizeCountry('PAK')).toBe('PK');
    expect(normalizeCountry('KOS')).toBe('XK');
    expect(normalizeCountry('NGR')).toBe('NG');
    expect(normalizeCountry('GEO')).toBe('GE');
    expect(normalizeCountry('BRN')).toBe('BH'); // FIFA-Bahrain (not ISO-Brunei)
    expect(normalizeCountry('LIT')).toBe('LT');
    expect(normalizeCountry('ARM')).toBe('AM');
    expect(normalizeCountry('AZE')).toBe('AZ');
  });

  it('does not collapse POR and PRT to different values', () => {
    // Both Portuguese codes should map to PT — sanity-check we keep
    // the FIFA alias in lockstep with the ISO code.
    expect(normalizeCountry('POR')).toBe(normalizeCountry('PRT'));
    expect(normalizeCountry('POR')).toBe('PT');
  });

  it('handles the deployed flag shim in src/types/match.ts (alpha-2 + alpha-3 in)', () => {
    // Regression: the countryFlag shim added in 2026-04-23 accepts
    // both formats at DISPLAY time as defense-in-depth. This write-
    // time normalizer is the authoritative layer — ensure identical
    // outputs for the inputs that shim already handled.
    const inputs = ['ESP', 'ES', 'FRA', 'FR', 'POR', 'PT', 'NED', 'NL'];
    const outputs = inputs.map(normalizeCountry);
    expect(outputs).toEqual(['ES', 'ES', 'FR', 'FR', 'PT', 'PT', 'NL', 'NL']);
  });
});

describe('fipCountryNameToAlpha2', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(fipCountryNameToAlpha2(null)).toBeNull();
    expect(fipCountryNameToAlpha2(undefined)).toBeNull();
    expect(fipCountryNameToAlpha2('')).toBeNull();
    expect(fipCountryNameToAlpha2('   ')).toBeNull();
  });

  it('maps common FIP country names to alpha-2 codes', () => {
    // Core nations seen in every recent FIP draw.
    expect(fipCountryNameToAlpha2('Spain')).toBe('ES');
    expect(fipCountryNameToAlpha2('Argentina')).toBe('AR');
    expect(fipCountryNameToAlpha2('Italy')).toBe('IT');
    expect(fipCountryNameToAlpha2('France')).toBe('FR');
    expect(fipCountryNameToAlpha2('Brazil')).toBe('BR');
    expect(fipCountryNameToAlpha2('Belgium')).toBe('BE');
    expect(fipCountryNameToAlpha2('Portugal')).toBe('PT');
  });

  it('handles FIP-specific non-standard spellings', () => {
    // FIP's flag filenames use some quirky spellings we have to preserve.
    expect(fipCountryNameToAlpha2('TheNetherlands')).toBe('NL');
    expect(fipCountryNameToAlpha2('Marocco')).toBe('MA');      // Italian "Morocco"
    expect(fipCountryNameToAlpha2('Israele')).toBe('IL');      // Italian "Israel"
    expect(fipCountryNameToAlpha2('Luxemburg')).toBe('LU');
    expect(fipCountryNameToAlpha2('GreatBritain')).toBe('GB');
    expect(fipCountryNameToAlpha2('UAE')).toBe('AE');
    // Still accepts the canonical English spelling as a fallback.
    expect(fipCountryNameToAlpha2('Netherlands')).toBe('NL');
  });

  it('is case-insensitive', () => {
    expect(fipCountryNameToAlpha2('SPAIN')).toBe('ES');
    expect(fipCountryNameToAlpha2('spain')).toBe('ES');
    expect(fipCountryNameToAlpha2('Spain')).toBe('ES');
    expect(fipCountryNameToAlpha2('  thenetherlands  ')).toBe('NL');
  });

  it('returns null SILENTLY for unknown names (no console output)', () => {
    // The whole point of the helper is to avoid normalizeCountry's
    // warn-per-unknown log spam when we know up-front that FIP emits
    // names, not codes. Regression test so nobody sneaks a console.warn
    // back in.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(fipCountryNameToAlpha2('Atlantis')).toBeNull();
    expect(fipCountryNameToAlpha2('ZZZ_FICTIONAL')).toBeNull();
    expect(fipCountryNameToAlpha2('NorthKorea')).toBeNull(); // not in map yet — really null

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
