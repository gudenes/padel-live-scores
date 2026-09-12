// apps/ops/src/lib/amateur-court-history.ts
// Pure shaping of an amateur player's team-model court history for the ops
// player profile aggregator. Mirrors the domain rules already codified at the
// repo root in src/lib/amateur-derive.ts / src/lib/amateur-profile.ts (not
// imported directly — apps/ops is an independent package with its own
// node_modules — but the "exact && court_count === 1" certainty test and the
// worth→court-block mapping must stay in sync with that file).
//
// The source data (team_fixture_slots) never carries an opponent or a
// per-set score — only won/lost and how many sets it lasted. Nothing here
// invents either.

export interface AmateurSlotMembershipRow {
  slot_id: string
  slot: {
    id: string
    fixture_id: string
    label: string
    worth: number
    result: string | null
    sets: number | null
    court_count: number
    exact: boolean
    partial: boolean
    sort_order: number
    fixture: {
      id: string
      code: string
      label: string
      sort_order: number
      complete: boolean
      result: string | null
      team_season_id: string
      season: {
        id: string
        label: string
        starts_on: string | null
        team: { id: string; name: string } | null
      } | null
    } | null
  } | null
}

export interface AmateurSlotPartnersRow {
  id: string // team_fixture_slots.id
  players: Array<{
    player_id: string
    player: { id: string; name: string } | null
  }>
}

export interface AmateurCourtHistoryPartner {
  id: string
  name: string
}

export interface AmateurCourtHistoryRow {
  slotId: string
  seasonLabel: string
  teamName: string
  fixtureCode: string
  fixtureLabel: string
  /** false = the round is a partial record (still in progress or incompletely imported). */
  fixtureComplete: boolean
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  /**
   * True only when the pairing on this court is certain. A slot spanning
   * more than one court can never pin the pairing down, whatever `exact`
   * says on its own — same test as buildAmateurProfile at the repo root.
   */
  exact: boolean
  courtCount: number
  partners: AmateurCourtHistoryPartner[]
}

function asResult(value: string | null): 'W' | 'L' | null {
  return value === 'W' || value === 'L' ? value : null
}

export function courtBlockLabel(worth: number): string {
  if (worth === 3) return 'Courts 1–2'
  if (worth === 2) return 'Courts 3–5'
  return `Worth ${worth}`
}

export function buildAmateurCourtHistory(
  playerId: string,
  membershipRows: AmateurSlotMembershipRow[],
  partnerRows: AmateurSlotPartnersRow[],
): AmateurCourtHistoryRow[] {
  const partnersBySlot = new Map<string, AmateurCourtHistoryPartner[]>()
  for (const row of partnerRows) {
    const partners = row.players
      .filter((p) => p.player_id !== playerId && p.player != null)
      .map((p) => ({ id: p.player!.id, name: p.player!.name }))
    partnersBySlot.set(row.id, partners)
  }

  const rows = membershipRows
    .map((row) => {
      const slot = row.slot
      const fixture = slot?.fixture
      if (!slot || !fixture) return null
      return {
        slot,
        fixture,
        season: fixture.season,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map(({ slot, fixture, season }) => ({
      slotId: slot.id,
      seasonLabel: season?.label ?? '',
      seasonStartsOn: season?.starts_on ?? null,
      teamName: season?.team?.name ?? '',
      fixtureCode: fixture.code,
      fixtureLabel: fixture.label,
      fixtureComplete: fixture.complete,
      fixtureSortOrder: fixture.sort_order,
      slotSortOrder: slot.sort_order,
      worth: slot.worth,
      result: asResult(slot.result),
      sets: slot.sets,
      exact: slot.exact && slot.court_count === 1,
      courtCount: slot.court_count,
      partners: partnersBySlot.get(slot.id) ?? [],
    }))

  // Most recent first: season start date desc (undated seasons sort after
  // dated ones, mirroring sortSeasonRefs), then round desc, then court asc.
  rows.sort((a, b) => {
    if (a.seasonStartsOn && b.seasonStartsOn) {
      const cmp = b.seasonStartsOn.localeCompare(a.seasonStartsOn)
      if (cmp !== 0) return cmp
    } else if (a.seasonStartsOn || b.seasonStartsOn) {
      return a.seasonStartsOn ? -1 : 1
    }
    if (a.seasonLabel !== b.seasonLabel) return b.seasonLabel.localeCompare(a.seasonLabel)
    if (a.fixtureSortOrder !== b.fixtureSortOrder) return b.fixtureSortOrder - a.fixtureSortOrder
    return a.slotSortOrder - b.slotSortOrder
  })

  return rows.map((r) => ({
    slotId: r.slotId,
    seasonLabel: r.seasonLabel,
    teamName: r.teamName,
    fixtureCode: r.fixtureCode,
    fixtureLabel: r.fixtureLabel,
    fixtureComplete: r.fixtureComplete,
    worth: r.worth,
    result: r.result,
    sets: r.sets,
    exact: r.exact,
    courtCount: r.courtCount,
    partners: r.partners,
  }))
}
