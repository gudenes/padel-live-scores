-- Larger-sample verification of the Premier Padel geo seed.
-- Sampling 200 recent uploads (67 carried a regionRestriction blocked list,
-- checked 2026-06-09) showed Italy, San Marino and Vatican are blocked in only
-- ~21/67 ≈ 31% of restricted uploads — below the 60% confidence bar used for
-- block rules. The initial 50-video snapshot over-represented them (90%).
-- Everything else in the seed sits at ≥66%, so only these three are removed.
-- Operators can re-add any of them via the admin UI if a specific rights
-- window warrants it.
DELETE FROM channel_region_rules
WHERE source = 'seed'
  AND channel_id IN (SELECT id FROM youtube_channels WHERE abbreviation = 'PP')
  AND country_iso2 IN ('it', 'sm', 'va');
