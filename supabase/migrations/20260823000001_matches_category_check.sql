-- matches.category was the only column in the gender domain without a CHECK.
-- Every sibling table already constrains it -- tournament_draws,
-- padelgod.entry_list_snapshots / draw_snapshots / oop_snapshots / results_snapshots,
-- player_tournament_earnings, model_tournament_predictions -- so a bad value
-- was rejected everywhere except on the table the UI actually reads.
--
-- Deliberately does NOT allow a third value. The app has no mixed-doubles
-- concept: every gender surface is a binary men/women filter using strict
-- equality, so a 'mixed' row would silently vanish from BOTH tabs rather
-- than render. Adding mixed support is a product decision that should come
-- with its own migration and UI, not slip in through a permissive constraint.
--
-- Verified clean before adding: 14430 'men' + 5386 'women', zero NULL,
-- zero other values. Left nullable to match the existing insert paths.

alter table matches
  add constraint matches_category_check
  check (category is null or category in ('men', 'women'));
