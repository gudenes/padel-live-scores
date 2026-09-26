// src/lib/tab-seen.ts
//
// "New" chip state for the merged Entries tab. Before the merge, Entries and
// Projection each had their own localStorage flag. Someone who opened either
// one has already discovered the tab, so both keys count as seen — but only
// the entries key is written from here on.

export const ENTRIES_TAB_SEEN_KEY = 'entry_list_tab_seen'
const LEGACY_PROJECTION_SEEN_KEY = 'projection_tab_seen'

/** Pass a localStorage-like getter. Safe against Safari private-mode throws. */
export function readEntriesTabSeen(getItem: (key: string) => string | null): boolean {
  try {
    return getItem(ENTRIES_TAB_SEEN_KEY) === '1' || getItem(LEGACY_PROJECTION_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
