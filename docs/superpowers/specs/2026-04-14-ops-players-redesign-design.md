# Ops Players Tab Redesign — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Problem

The current Players tab in the ops dashboard has a basic table with inconsistent UX:
- No data completeness visibility (can't see which players need attention)
- No filters beyond text search (can't filter by "missing equipment" or "missing avatar")
- Edit panel renders below the table (lose context of the list)
- No bulk operations (must edit players one by one)
- No pagination (capped at 50 results)
- No checkboxes for multi-select

With 3,156 players (only 34 with equipment, 313 with avatars), the primary workflow is "find incomplete records and fix them" — the current UI doesn't support this well.

## Design

### 1. Table Columns (7 columns)

| # | Column | Width | Content |
|---|--------|-------|---------|
| 1 | Checkbox | 32px | Bulk select checkbox. Header has "select all" checkbox. |
| 2 | Avatar + Flag | 48px | 24px avatar thumbnail with country flag (16px) overlaid at bottom-right. Placeholder circle with "?" if no avatar. |
| 3 | Name | flex | Primary: `name` (font-weight 500). Subtitle: `display_name` if different (font-size 10, color #6B7280). |
| 4 | Rank | 60px | `#4` format or `—` if null. Color #111. |
| 5 | Category | 50px | `M` or `W` badge. Blue (#DBEAFE/#1E40AF) for men, pink (#FCE7F3/#9D174D) for women. |
| 6 | Equipment | 160px | `Brand Model` (brand bold) or `—` if none. Font-size 10. |
| 7 | Completeness | 80px | 4 colored dots (8px circles, 4px gap): avatar, ranking, fip_id, equipment. Green (#22c55e) = has data. Red (#ef4444) = missing. Tooltip on hover shows field name. |

Removed columns: Points (rarely actionable), Actions (row click opens drawer).

### 2. Filter Chips

Horizontal row of clickable chips above the table, after the search input.

**Chips:**
- `All ({totalCount})` — default active, shows all players
- `Missing Equipment ({count})` — players without current equipment assignment
- `Missing Avatar ({count})` — players where avatar_url is null
- `Missing Ranking ({count})` — players where ranking is null
- `Men` / `Women` — category filter

**Behavior:**
- Data quality chips (Missing Equipment/Avatar/Ranking) are mutually exclusive with each other but can combine with Men/Women.
- Active chip gets filled background (#111 text on #f3f4f6 bg → #fff text on #111 bg when active).
- Counts are fetched once on mount and cached (not re-fetched on every filter change).

**API change:** The search-players API gains new query params:
- `filter=missing_equipment|missing_avatar|missing_ranking` — server-side filtering
- `page=1&per_page=25` — pagination
- Existing `q` (search) and `category` params continue working

### 3. Bulk Actions Bar

Appears as a sticky bar between filters and table when 1+ rows are selected.

**Layout:** `✓ {count} selected` (left) | action buttons (right) | `Clear` (far right)

**Actions:**
- **Assign Equipment** — opens modal with brand → racket dropdown. On confirm, POST to a new bulk endpoint that assigns the selected racket to all selected players.
- **Set Category** — dropdown to set men/women for all selected players.

**Deselect behavior:** Changing page clears selection. Changing filters clears selection.

### 4. Right Drawer (Overlay)

Slides in from right side, 420px wide, with a semi-transparent backdrop. Click outside or press Escape to close.

**Header area:**
- Large avatar (64px, rounded) with an "Upload" overlay on hover
- Player name (16px, bold)
- Ranking badge (`#4 Women` in green)
- Country flag + country name

**Quick stats row:**
- Matches | Win Rate | Titles (3 boxes, same as player profile hero)

**Edit form — 3 tabs:**
- **Profile:** name, display_name, country, category, side, hand, height, birthdate, birthplace
- **IDs:** external_id, fip_id (read-only display of padelapi_id)
- **Equipment:** Current racket display (brand + model + image), "Change" button with brand → racket dropdowns, equipment history list

**Save behavior:**
- Sticky "Save Changes" button at bottom of drawer
- Button disabled until a field is modified
- On save, PATCH to existing `/api/ops/players` endpoint
- Toast-style success message (green bar at top of drawer, auto-dismiss 3s)

**Navigation:**
- Arrow keys ↑↓ move to prev/next player in the current list without closing drawer
- Updates the drawer content with the new player's data

### 5. Pagination

Server-side pagination with 25 rows per page.

**Controls** at bottom of table:
- `← Previous` | `Page {n} of {totalPages}` | `Next →`
- Previous disabled on page 1, Next disabled on last page

**API change:** search-players returns `{ players: [...], total: number, page: number, per_page: number }`.

**Implementation:** Use Supabase's `.range(from, to)` for offset-based pagination. The `total` count comes from `{ count: 'exact' }` option.

### 6. File Structure

The current `PlayersTab.tsx` is 1,350 lines. Break it into focused components:

| File | Purpose |
|------|---------|
| `src/app/ops/players/PlayersTab.tsx` | Main container: state, filters, pagination, data fetching |
| `src/app/ops/players/PlayersTable.tsx` | Table rendering: columns, rows, checkboxes, completeness dots |
| `src/app/ops/players/PlayerDrawer.tsx` | Right drawer: edit form, tabs, save logic |
| `src/app/ops/players/BulkActionsBar.tsx` | Bulk action bar: selection count, action buttons, modals |
| `src/app/ops/players/FilterChips.tsx` | Filter chips row with counts |

The current monolith stays as a re-export wrapper initially so the OpsClient import doesn't break.

### 7. Consistent Styling

All text colors follow the 3-tier system established in the color standardization:
- `#111` — primary text (names, values)
- `#6B7280` — secondary text (labels, subtitles)
- `#9ca3af` — tertiary/disabled (placeholders, loading)
- `#d1d5db` — empty state dashes

Table styles use the existing `thStyle` and `tdStyle` constants.
Buttons use `btnPrimary` and `btnSecondary` constants.
Drawer uses white background with subtle border-left shadow.
