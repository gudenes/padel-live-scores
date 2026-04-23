-- Extend padelgod.draw_snapshots with fields that only the FIP event-page
-- draw fetcher can supply (and the existing Crionet draw widget cannot):
--   * match_widget_id — the "MD004" / "WQ011" ID FIP and Crionet both use,
--     key join for linking draw entries to public.matches and OOP snapshots.
--   * team1_fip_id / team2_fip_id — FIP's pair/team identifier (e.g. "P000456")
--     taken from `data-single-team`. Deterministic pair identity across
--     tournaments; useful for future draw-aware population of match FKs.
--   * team1_seed / team2_seed were already columns (nullable); no change.
--   * source — discriminator between 'crionet_draw_widget' (existing
--     fetcher) and 'fip_event_page' (new). Lets reconcilers prefer the
--     richer FIP source when both are present for the same bracket slot.
--
-- All nullable — the existing Crionet draw fetcher won't populate them.
-- No data migration needed (append-only snapshot table).

ALTER TABLE padelgod.draw_snapshots
  ADD COLUMN IF NOT EXISTS match_widget_id TEXT,
  ADD COLUMN IF NOT EXISTS team1_fip_id    TEXT,
  ADD COLUMN IF NOT EXISTS team2_fip_id    TEXT,
  ADD COLUMN IF NOT EXISTS source          TEXT;

COMMENT ON COLUMN padelgod.draw_snapshots.match_widget_id IS
  'Widget-visible match ID (e.g. "MD004", "WQ011"). Shared between FIP '
  'event page (data-match-id attribute) and Crionet widgets (data-id '
  'attribute on the stats button). Primary join key for linking draw '
  'entries to public.matches and Crionet OOP snapshots.';

COMMENT ON COLUMN padelgod.draw_snapshots.team1_fip_id IS
  'FIP team/pair identifier (e.g. "P000456") captured from the event '
  'page data-single-team attribute. Stable across tournaments for the '
  'same pair.';

COMMENT ON COLUMN padelgod.draw_snapshots.team2_fip_id IS
  'See team1_fip_id.';

COMMENT ON COLUMN padelgod.draw_snapshots.source IS
  'Parser origin: "crionet_draw_widget" for existing widget.matchscorerlive.com '
  'scraper; "fip_event_page" for the padelfip.com AJAX scraper. Reconciler '
  'picks the richer source when both are present.';

CREATE INDEX IF NOT EXISTS draw_snapshots_tournament_widget_idx
  ON padelgod.draw_snapshots (tournament_id, match_widget_id)
  WHERE match_widget_id IS NOT NULL;
