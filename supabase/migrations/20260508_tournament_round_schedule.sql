-- Per-round schedule scraped from the FIP overview block. Read at render
-- time on the tournament detail page to surface placeholder tabs for
-- rounds that haven't been drawn yet (e.g. SF/F mid-tournament).
--
-- Shape: { q1?, q2?, q3?, r64?, r32?, r16?, qf?, sf?, f? : ISO YYYY-MM-DD }.
-- Missing rounds = absent (NOT zero/empty). Single date per round; when
-- the source has different qualifying dates for men/women, the parser
-- stores the earliest. See padelgod/src/parsers/fip-schedule-notes.ts.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS round_schedule JSONB;

COMMENT ON COLUMN tournaments.round_schedule IS
  'Per-round schedule scraped from the FIP overview. Single ISO date '
  'per round key. Keys: q1, q2, q3, r64, r32, r16, qf, sf, f. Missing '
  'rounds = absent (NOT zero/empty). Earliest date wins when men/women '
  'differ on qualifying rounds. See parseScheduleNotes for format details.';
