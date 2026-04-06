# Next Session Priorities

## Priority 1: Editable Tournament Data in Ops Dashboard

### Flow
1. Readiness tab → click tournament → opens a **Tournament Manager** view
2. Shows two sections: **Entry List** and **Draw** (per category)
3. Each shows the seeded data from `tournament_draws` in an editable table
4. Columns: Position, Seed, Marker (Q/WC/LL), Player 1 (name + ID link), Player 2 (name + ID link), Team Points
5. User can:
   - Edit seed numbers
   - Change marker (Q/WC/LL/none)
   - Re-link player IDs (search + select from DB)
   - Edit player names
   - Delete a row
   - Add a new row
6. Save changes → PATCH/PUT to `tournament_draws`
7. Shows validation: top-100 players without DB link = warning

### API needed
- GET `/api/ops/tournament-draws?tournament_id=X` — returns all draws for tournament
- PATCH `/api/ops/tournament-draws` — update individual draw entries
- DELETE `/api/ops/tournament-draws/:id` — remove entry
- POST `/api/ops/tournament-draws` — add new entry

### Tables affected
- `tournament_draws` (read + write)

---

## Priority 2: Player Management Tab in Ops

### Flow
1. New "Players" tab in Ops dashboard (under Tournament Manager group)
2. Search/browse players with filters (name, country, category, ranking range)
3. Player detail panel shows all fields: name, country, ranking, points, avatar, external_id, fip_id, category, side, etc.
4. **Edit mode**: modify any field inline
5. **Merge mode**: select two player profiles → side-by-side comparison
   - For each field, show both values and pick which to keep
   - Conflicting fields highlighted
   - Merge action: keeps one profile, transfers all match references from the other, deletes the duplicate
6. **Enrich mode**: auto-fill missing data from padelapi or FIP sources

### API needed
- GET `/api/ops/players?q=X&category=Y` — search (already exists as search-players)
- GET `/api/ops/players/:id` — full player detail
- PATCH `/api/ops/players/:id` — update player fields
- POST `/api/ops/players/merge` — merge two profiles (reassign all match FKs, delete duplicate)

### Tables affected
- `players` (read + write)
- `matches` (update FKs during merge: pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id)
- `tournament_draws` (update player1_id, player2_id during merge)

---

## Backlog (from earlier)
- Editable seeded entry lists (load back parsed data for review)
- Draw size validation (expected matches vs actual)
- NachoWatch proactive alerts
- QA testing agent (Playwright)
