import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../../lib/env.js';

// Minimum required string vars for the schema to parse — supplied per-test
// via `withEnv` so we don't pollute the real process.env.
const REQUIRED = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_KEY: 'fake-service-key',
  PADELGOD_ADMIN_TOKEN: 'fake-admin-token',
};

describe('loadEnv — boolean flag parsing (regression test for the 2026-04-25 dry-run bug)', () => {
  // Background: until 2026-04-25 every flag in env.ts used z.coerce.boolean(),
  // which delegates to JavaScript's Boolean(value). Every non-empty string is
  // truthy in JS — so FIP_DRAW_POPULATOR_DRY_RUN="false" parsed back to true,
  // identical to the schema default. The populator stayed in dry-run for
  // every cron after we tried to disable it. Fixed by replacing
  // z.coerce.boolean() with a string-aware boolEnv() helper. These tests
  // pin that behaviour so the same regression can't ship again.

  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = { ...process.env };
  });
  afterEach(() => {
    process.env = original;
  });

  function withEnv(extra: Record<string, string | undefined>) {
    process.env = { ...REQUIRED, ...extra } as NodeJS.ProcessEnv;
  }

  it('parses "false" as false (the bug that bit us in prod)', () => {
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: 'false' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(false);
  });

  it('parses "true" as true', () => {
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: 'true' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(true);
  });

  it('preserves the schema default when unset', () => {
    withEnv({});
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(true);
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(false);
  });

  it('accepts numeric and yes/no spellings', () => {
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: '0' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(false);

    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: '1' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(true);

    withEnv({ ENABLE_FIP_DRAW_POPULATOR: 'yes' });
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(true);

    withEnv({ ENABLE_FIP_DRAW_POPULATOR: 'no' });
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(false);

    withEnv({ ENABLE_FIP_DRAW_POPULATOR: 'on' });
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(true);

    withEnv({ ENABLE_FIP_DRAW_POPULATOR: 'off' });
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(false);
  });

  it('treats the empty string as false', () => {
    // Some platforms (incl. older Railway UI behavior) coerce unset env
    // vars to the empty string. We treat that as a deliberate "off"
    // because there's no realistic case where empty means "I want true".
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: '' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(false);
  });

  it('is case-insensitive and trims whitespace', () => {
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: '  FALSE  ' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(false);

    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: 'TRUE' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(true);
  });

  it('falls back to default on unrecognised values (typo safety)', () => {
    // A typo like "fals" should NOT silently flip a default-true flag
    // off. Falling back to the default is safer than guessing.
    withEnv({ FIP_DRAW_POPULATOR_DRY_RUN: 'fals' });
    expect(loadEnv().FIP_DRAW_POPULATOR_DRY_RUN).toBe(true);

    withEnv({ ENABLE_FIP_DRAW_POPULATOR: 'maybe' });
    expect(loadEnv().ENABLE_FIP_DRAW_POPULATOR).toBe(false);
  });

  it('parses every documented flag the same way (smoke test)', () => {
    // Verify the helper is wired up consistently across the file —
    // catches a future PR that switches one flag back to z.coerce.boolean()
    // without noticing.
    withEnv({
      ENABLE_SCHEDULER: 'false',
      ENABLE_TOURNAMENT_DISCOVERY: 'false',
      ENABLE_FIP_OOP_WRITER: 'true',
      FIP_OOP_WRITER_DRY_RUN: 'false',
      ENABLE_FIP_RESULTS_WRITER: 'true',
      FIP_RESULTS_WRITER_DRY_RUN: 'false',
      ENABLE_FIP_WINNER_PROPAGATOR: 'true',
      FIP_WINNER_PROPAGATOR_DRY_RUN: 'false',
    });
    const env = loadEnv();
    expect(env.ENABLE_SCHEDULER).toBe(false);
    expect(env.ENABLE_TOURNAMENT_DISCOVERY).toBe(false);
    expect(env.ENABLE_FIP_OOP_WRITER).toBe(true);
    expect(env.FIP_OOP_WRITER_DRY_RUN).toBe(false);
    expect(env.ENABLE_FIP_RESULTS_WRITER).toBe(true);
    expect(env.FIP_RESULTS_WRITER_DRY_RUN).toBe(false);
    expect(env.ENABLE_FIP_WINNER_PROPAGATOR).toBe(true);
    expect(env.FIP_WINNER_PROPAGATOR_DRY_RUN).toBe(false);
  });
});
