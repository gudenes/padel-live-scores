import { describe, it, expect } from 'vitest';
import { createLogger } from '../lib/logger.js';

describe('createLogger', () => {
  it('returns a pino logger with the configured level', () => {
    const logger = createLogger({ level: 'warn', service: 'padelgod-test' });
    expect(logger.level).toBe('warn');
  });

  it('includes service name in bindings', () => {
    const logger = createLogger({ level: 'info', service: 'padelgod-svc' });
    expect(logger.bindings()).toMatchObject({ service: 'padelgod-svc' });
  });

  it('child logger inherits bindings and adds new ones', () => {
    const root = createLogger({ level: 'info', service: 'padelgod' });
    const child = root.child({ worker: 'tournament-discovery' });
    expect(child.bindings()).toMatchObject({ service: 'padelgod', worker: 'tournament-discovery' });
  });
});
