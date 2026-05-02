import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';

import { runWidgetCodeLookup } from '../workers/widget-code-lookup.js';
import { runEntryListFetcher } from '../workers/entry-list-fetcher.js';
import { runFipEntryListPopulator } from '../workers/fip-entry-list-populator.js';
import { runDrawFetcher } from '../workers/draw-fetcher.js';
import { runFipDrawFetcher } from '../workers/fip-draw-fetcher.js';
import { runFipDrawPopulator } from '../workers/fip-draw-populator.js';
import { runOopFetcher } from '../workers/oop-fetcher.js';
import { runFipOopWriter } from '../workers/fip-oop-writer.js';
import { runResultsFetcher } from '../workers/results-fetcher.js';
import { runFipResultsWriter } from '../workers/fip-results-writer.js';
import { runMatchStatsFetcher } from '../workers/match-stats-fetcher.js';

export interface RefreshTournamentOptions {
  adminToken: string;
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory mutex — one refresh per tournament at a time. Padelgod runs as a
// single Railway process, so a Set is enough; if it ever grows to multiple
// instances we'd need a DB-backed lock.
const inFlight = new Set<string>();

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: unknown;
  error?: string;
}

export function registerRefreshTournamentRoute(
  app: FastifyInstance,
  opts: RefreshTournamentOptions,
): void {
  app.post('/admin/refresh-tournament', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${opts.adminToken}`) {
      reply.status(401);
      return { error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing admin token' } };
    }

    const body = req.body as { tournamentId?: string } | undefined;
    const tournamentId = body?.tournamentId?.trim().toLowerCase();
    if (!tournamentId || !UUID_RE.test(tournamentId)) {
      reply.status(400);
      return {
        error: {
          code: 'INVALID_INPUT',
          message: 'Body must include { "tournamentId": "<uuid>" }',
        },
      };
    }

    const { data: tournamentRow, error: tErr } = await opts.supabase
      .from('tournaments')
      .select('id, name')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tErr) {
      opts.logger.error({ err: tErr, tournamentId }, 'tournament lookup failed');
      reply.status(500);
      return { error: { code: 'INTERNAL_ERROR', message: tErr.message } };
    }
    if (!tournamentRow) {
      reply.status(404);
      return { error: { code: 'NOT_FOUND', message: `tournament ${tournamentId} not found` } };
    }

    if (inFlight.has(tournamentId)) {
      reply.status(409);
      return {
        error: {
          code: 'IN_FLIGHT',
          message: `refresh for tournament ${tournamentId} already running`,
        },
      };
    }
    inFlight.add(tournamentId);

    const allowlist = new Set([tournamentId]);
    const childLogger = opts.logger.child({
      handler: 'refresh-tournament',
      tournamentId,
      tournamentName: tournamentRow.name,
    });
    childLogger.info('Refresh started');

    const stepResults: StepResult[] = [];

    const runStep = async (
      name: string,
      fn: () => Promise<unknown>,
    ): Promise<void> => {
      const startedAt = Date.now();
      try {
        const summary = await fn();
        const durationMs = Date.now() - startedAt;
        childLogger.info({ step: name, durationMs, summary }, 'Step ok');
        stepResults.push({ name, ok: true, durationMs, summary });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        childLogger.error({ step: name, durationMs, err }, 'Step failed');
        stepResults.push({ name, ok: false, durationMs, error: message.slice(0, 1000) });
      }
    };

    const stepLogger = childLogger.child({ source: 'refresh-tournament' });

    try {
      await runStep('widget-code-lookup', () =>
        runWidgetCodeLookup({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('entry-list-fetcher', () =>
        runEntryListFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('fip-entry-list-populator', () =>
        runFipEntryListPopulator({
          supabase: opts.supabase,
          logger: stepLogger,
          dryRun: false,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('draw-fetcher', () =>
        runDrawFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('fip-draw-fetcher', () =>
        runFipDrawFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          logger: stepLogger,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('fip-draw-populator', () =>
        runFipDrawPopulator({
          supabase: opts.supabase,
          logger: stepLogger,
          dryRun: false,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('oop-fetcher', () =>
        runOopFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('fip-oop-writer', () =>
        runFipOopWriter({
          supabase: opts.supabase,
          logger: stepLogger,
          dryRun: false,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('results-fetcher', () =>
        runResultsFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('fip-results-writer', () =>
        runFipResultsWriter({
          supabase: opts.supabase,
          logger: stepLogger,
          dryRun: false,
          onlyTournamentIds: allowlist,
        }),
      );
      await runStep('match-stats-fetcher', () =>
        runMatchStatsFetcher({
          supabase: opts.supabase,
          httpClient: opts.httpClient,
          onlyTournamentIds: allowlist,
        }),
      );
    } finally {
      inFlight.delete(tournamentId);
    }

    const ok = stepResults.every((s) => s.ok);
    childLogger.info({ ok, steps: stepResults.length }, 'Refresh complete');
    return {
      data: {
        tournamentId,
        tournamentName: tournamentRow.name,
        ok,
        stepResults,
      },
    };
  });
}
