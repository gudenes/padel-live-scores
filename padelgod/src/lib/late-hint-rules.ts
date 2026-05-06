export type LateHint = 'may_be_late' | 'starting_soon' | null;

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'on_court'
  | 'finished'
  | 'retired'
  | 'walkover'
  | string;

export interface LateHintMatchInput {
  id: string;
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  courtOrder: number;
}

export interface LateHintResult {
  id: string;
  lateHint: LateHint;
}

type ChainState = 'clear' | 'running_over' | 'delayed' | 'just_finished';

const RECENT_FINISH_WINDOW_MS = 60 * 60_000; // 60 min

function chainStateFromPredecessor(
  prev: LateHintMatchInput | null,
  prevHint: LateHint,
  nowMs: number,
  expectedDurationMs: number,
): ChainState {
  if (!prev) return 'clear';

  if (prev.status === 'live') {
    const startMs = prev.startedAt ? Date.parse(prev.startedAt) : NaN;
    if (!Number.isNaN(startMs) && nowMs - startMs > expectedDurationMs) {
      return 'running_over';
    }
    return 'clear';
  }

  if (prev.status === 'scheduled') {
    const schedMs = prev.scheduledAt ? Date.parse(prev.scheduledAt) : NaN;
    if (!Number.isNaN(schedMs) && schedMs < nowMs) return 'delayed';
    if (prevHint === 'may_be_late') return 'delayed'; // cascade through future-time predecessor
    return 'clear';
  }

  if (prev.status === 'finished' || prev.status === 'retired' || prev.status === 'walkover') {
    const finMs = prev.finishedAt ? Date.parse(prev.finishedAt) : NaN;
    if (!Number.isNaN(finMs) && nowMs - finMs <= RECENT_FINISH_WINDOW_MS) {
      return 'just_finished';
    }
    return 'clear';
  }

  return 'clear';
}

export function computeLateHintsForGroup(
  matchesInOrder: LateHintMatchInput[],
  now: Date,
  expectedDurationMinutes: number,
): LateHintResult[] {
  const nowMs = now.getTime();
  const expectedDurationMs = expectedDurationMinutes * 60_000;

  const out: LateHintResult[] = [];
  let prev: LateHintMatchInput | null = null;
  let prevHint: LateHint = null;

  for (const m of matchesInOrder) {
    if (m.status !== 'scheduled') {
      out.push({ id: m.id, lateHint: null });
      prev = m;
      prevHint = null;
      continue;
    }

    const schedMs = m.scheduledAt ? Date.parse(m.scheduledAt) : NaN;
    const selfDelayed = !Number.isNaN(schedMs) && schedMs < nowMs;

    const chain = chainStateFromPredecessor(prev, prevHint, nowMs, expectedDurationMs);

    let hint: LateHint;
    if (selfDelayed) {
      hint = 'may_be_late';
    } else if (chain === 'running_over' || chain === 'delayed') {
      hint = 'may_be_late';
    } else if (chain === 'just_finished') {
      hint = 'starting_soon';
    } else {
      hint = null;
    }

    out.push({ id: m.id, lateHint: hint });
    prev = m;
    prevHint = hint;
  }

  return out;
}
