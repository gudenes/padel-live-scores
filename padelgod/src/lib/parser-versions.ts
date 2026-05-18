// Parser version constants. Bump when a parser's logic changes — recorded in
// padelgod.scrape_jobs.parser_version so we can correlate scrape failures with
// parser deploys.

export const FIP_WP_EVENTS_VERSION = 'fip-wp-events-1.0.0';
export const CRIONET_SEARCH_VERSION = 'crionet-search-1.0.0';
// Bumped 2026-05-18 when the rankings worker switched from HTML-scrape
// against the redesigned-and-broken padelfip.com/ranking page to the
// WP JSON API at /wp-json/fip/v1/ranking/load-more/ + .../player/search.
export const FIP_RANKINGS_VERSION = 'fip-rankings-wp-2.0.0';
export const FIP_PLAYER_PROFILE_VERSION = 'fip-player-profile-1.0.0';

// Note: CRIONET_ENTRY_LIST_VERSION used to live here. Removed when the
// entry-list fetcher was rewired to FIP PDFs (see
// padelgod/src/workers/entry-list-fetcher.ts). The new parser version
// 'fip_pdf_entry_list_v1' is recorded inline at the worker's scrape_job
// call site.
export const CRIONET_DRAW_VERSION = 'crionet-draw-1.0.0';
export const CRIONET_OOP_VERSION = 'crionet-oop-1.0.0';
export const CRIONET_RESULTS_VERSION = 'crionet-results-1.0.0';

export const CRIONET_TOURNAMENTLIVE_VERSION = 'crionet-tournamentlive-1.0.0';
export const CRIONET_MATCH_STATS_VERSION = 'crionet-match-stats-1.0.0';

// FIP event-page draw AJAX (www.padelfip.com/wp-admin/admin-ajax.php).
// Captures the full bracket in one payload per draw type (MD/WD/MQ/WQ),
// with `data-match-id` widget IDs as the primary join key.
export const FIP_EVENT_DRAW_VERSION = 'fip-event-draw-1.0.0';
