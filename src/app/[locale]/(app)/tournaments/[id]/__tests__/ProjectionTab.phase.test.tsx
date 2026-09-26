// @vitest-environment jsdom
//
// Exercises the phase switch itself: `rows.length === 0` (post-!loading gate)
// renders FieldView (phase `field`); non-empty rows render the existing
// projection UI; and while `loading` is true neither renders (the `…`
// placeholder wins) — proving the field view can't flash while projection
// rows are still in flight (see the fetch-gating fix in
// PadelNacho.ProjectionTab.tsx).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

// Fixed projection rows, mirroring ProjectionTab.slug-sync.test.tsx's fixture.
const ROWS = [
  {
    tournament_id: 't1', category: 'men',
    pair_key: 'aaaa::bbbb', pair_player_ids: ['aaaa', 'bbbb'],
    tournament_level: 'fip_platinum', status: 'active', eliminated_round: null,
    champion_prob: 0.4, finalist_prob: 0.6, semifinal_prob: 0.8,
    predicted_finish_round: 'F', rounds: [], computed_at: '2026-06-17T00:00:00Z',
  },
]

// Mixed-category entries. `men` has two entries, `women` has one — used to
// assert ProjectionTab filters entries down to the `category` prop before
// handing them to FieldView.
const ENTRIES = [
  { id: 'e1', seed: 1, marker: null, category: 'men' as const, player1_id: 'p1', player1_name: 'Maxi Arce', player1_country: 'AR', player2_id: 'p2', player2_name: 'Juan Tello', player2_country: 'ES', team_points: 5000 },
  { id: 'e2', seed: 2, marker: null, category: 'men' as const, player1_id: 'p3', player1_name: 'Ale Galan', player1_country: 'ES', player2_id: 'p4', player2_name: 'Juan Lebron', player2_country: 'ES', team_points: 4800 },
  { id: 'e3', seed: 1, marker: null, category: 'women' as const, player1_id: 'p5', player1_name: 'Gemma Triay', player1_country: 'ES', player2_id: 'p6', player2_name: 'Alejandra Salazar', player2_country: 'ES', team_points: 4600 },
]

// Mutable per-test hook return values, read by the mocked hooks below.
let projectionState: { rows: typeof ROWS; loading: boolean } = { rows: [], loading: false }
let entryState: { entries: typeof ENTRIES; loading: boolean; error: boolean } = { entries: [], loading: false, error: false }

vi.mock('../useProjection', () => ({
  useProjection: () => projectionState,
}))
vi.mock('../useEntryList', () => ({
  useEntryList: () => ({ ...entryState, playerMap: {} }),
  useHasEntries: () => false,
}))
vi.mock('../usePairImages', () => ({
  usePairImages: () => new Map([
    ['aaaa', { name: 'Maxi Arce', country: null, avatarUrl: null, photoUrl: null }],
    ['bbbb', { name: 'Juan Tello', country: null, avatarUrl: null, photoUrl: null }],
  ]),
}))
// next-intl's navigation pulls in `next/navigation`, which vitest can't resolve.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children?: React.ReactNode }) =>
    <a {...(rest as object)}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/',
}))
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }))
vi.mock('@/hooks/useProjectionVote', () => ({
  useProjectionVote: () => ({ yourVote: null, global: null, loading: false, vote: () => {} }),
}))
vi.mock('../ChampionSparkline', () => ({ default: () => null }))

// Spy on FieldView so we can assert (a) it rendered at all, via a marker the
// real projection list never shows, and (b) exactly which entries it was
// given — without re-testing FieldView's own internals (covered elsewhere).
const fieldViewSpy = vi.fn()
vi.mock('../FieldView', () => ({
  default: (props: { entries: typeof ENTRIES }) => {
    fieldViewSpy(props)
    return <div data-testid="field-view-marker">{props.entries.map((e) => e.id).join(',')}</div>
  },
}))

import ProjectionTab from '../ProjectionTab'

const messages = { projectionTab: {} as Record<string, string> }
function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} onError={() => {}} getMessageFallback={({ key }) => key}>
      {ui}
    </NextIntlClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  fieldViewSpy.mockClear()
})

describe('ProjectionTab phase switch', () => {
  it('phase field: no projection rows renders FieldView with entries filtered to category', () => {
    projectionState = { rows: [], loading: false }
    entryState = { entries: ENTRIES, loading: false, error: false }

    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
      />,
    )

    expect(screen.getByTestId('field-view-marker')).toBeTruthy()
    expect(fieldViewSpy).toHaveBeenCalledTimes(1)
    const passedEntries = fieldViewSpy.mock.calls[0]![0].entries as typeof ENTRIES
    expect(passedEntries.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
    expect(passedEntries.every((e) => e.category === 'men')).toBe(true)
  })

  it('phase projected: non-empty rows render the projection UI, not FieldView', () => {
    projectionState = { rows: ROWS, loading: false }
    entryState = { entries: ENTRIES, loading: false, error: false }

    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
      />,
    )

    expect(screen.queryByTestId('field-view-marker')).toBeNull()
    expect(fieldViewSpy).not.toHaveBeenCalled()
    // ProjectionPickerList's header copy (getMessageFallback returns the key
    // itself since `messages` is empty) — unique to the projection list view.
    expect(screen.getByText('pickAPair')).toBeTruthy()
  })

  it('loading: neither FieldView nor the projection UI renders while projections are in flight', () => {
    projectionState = { rows: [], loading: true }
    entryState = { entries: ENTRIES, loading: false, error: false }

    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
      />,
    )

    expect(screen.queryByTestId('field-view-marker')).toBeNull()
    expect(fieldViewSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('pickAPair')).toBeNull()
  })
})
