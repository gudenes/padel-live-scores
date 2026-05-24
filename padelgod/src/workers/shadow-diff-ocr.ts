import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export interface ShadowDiffOcrDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** How far back to look for new snapshots. Default 5 minutes. */
  windowMinutes?: number;
}

export interface ShadowDiffOcrResult {
  snapshotsConsidered: number;
  diffsWritten: number;
  agreementCounts: Record<string, number>;
}

/**
 * Agreement classification between an OCR snapshot and the canonical
 * public.sets / public.games rows for the same match.
 *
 * V1 emits only:
 *   - 'match'                — sets agree
 *   - 'sets_disagree'        — sets differ
 *   - 'no_crionet_baseline'  — OCR has data but Crionet has none, or parse_error
 *
 * V2 will additionally emit:
 *   - 'game_disagree'        — current_game differs (requires reading public.games)
 *   - 'both_disagree'        — sets AND game differ
 *   - 'pair_label_mismatch'  — OCR'd player names don't match the resolved match
 *
 * The wider type matches the DB CHECK constraint on padelgod.ocr_diff_events
 * (which accepts all six) so the worker can grow into the V2 cases without
 * a schema change.
 */
type Agreement =
  | 'match'
  | 'sets_disagree'
  | 'game_disagree'
  | 'both_disagree'
  | 'no_crionet_baseline'
  | 'pair_label_mismatch';

interface OcrSnapshotRow {
  id: number;
  match_id: string;
  frame_at: string;
  parsed_score: {
    sets_completed: string[];
    current_game: string | null;
    pair1_label: string | null;
    pair2_label: string | null;
    parse_error: boolean;
  };
}

interface PublicSetRow {
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
}

export async function runShadowDiffOcr(
  deps: ShadowDiffOcrDeps,
): Promise<ShadowDiffOcrResult> {
  const { supabase, logger, windowMinutes = 5 } = deps;
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { data: snapshots, error } = await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select('id, match_id, frame_at, parsed_score')
    .gte('captured_at', cutoff)
    .not('match_id', 'is', null)
    .order('frame_at', { ascending: false });

  if (error) {
    logger?.error({ error }, 'failed to fetch ocr_snapshots');
    throw error;
  }

  const snapshotRows = (snapshots ?? []) as OcrSnapshotRow[];

  // Keep only the latest snapshot per match in this window
  const latestByMatch = new Map<string, OcrSnapshotRow>();
  for (const s of snapshotRows) {
    if (!latestByMatch.has(s.match_id)) {
      latestByMatch.set(s.match_id, s);
    }
  }

  const agreementCounts: Record<string, number> = {};
  let diffsWritten = 0;

  for (const snap of latestByMatch.values()) {
    const { data: sets } = await supabase
      .from('sets')
      .select('set_number, pair1_games, pair2_games')
      .eq('match_id', snap.match_id)
      .order('set_number', { ascending: true });

    const agreement = classify(snap.parsed_score, (sets ?? []) as PublicSetRow[]);
    agreementCounts[agreement] = (agreementCounts[agreement] ?? 0) + 1;

    const lagMs = Date.now() - new Date(snap.frame_at).getTime();
    await supabase.schema('padelgod').from('ocr_diff_events').insert({
      match_id: snap.match_id,
      ocr_snapshot_id: snap.id,
      agreement,
      ocr_score: snap.parsed_score,
      crionet_score: sets ?? null,
      lag_seconds: Math.floor(lagMs / 1000),
    });
    diffsWritten += 1;
  }

  logger?.info(
    { considered: latestByMatch.size, diffsWritten, agreementCounts },
    'shadow-diff-ocr complete',
  );

  return {
    snapshotsConsidered: latestByMatch.size,
    diffsWritten,
    agreementCounts,
  };
}

function classify(
  ocr: OcrSnapshotRow['parsed_score'],
  crionetSets: PublicSetRow[],
): Agreement {
  if (ocr.parse_error) {
    return 'no_crionet_baseline';
  }
  if (crionetSets.length === 0) {
    return 'no_crionet_baseline';
  }

  const ocrSetTuples = ocr.sets_completed.map((s) => s.split('-').map(Number));
  let setsAgree = true;
  for (let i = 0; i < ocrSetTuples.length; i += 1) {
    const ocrSet = ocrSetTuples[i];
    const crionetSet = crionetSets[i];
    if (!crionetSet || !ocrSet) { setsAgree = false; break; }
    if (ocrSet[0] !== crionetSet.pair1_games || ocrSet[1] !== crionetSet.pair2_games) {
      setsAgree = false; break;
    }
  }

  if (setsAgree) return 'match';
  return 'sets_disagree';
}
