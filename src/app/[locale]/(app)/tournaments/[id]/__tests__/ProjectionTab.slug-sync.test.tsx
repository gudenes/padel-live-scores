// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

// Fixed projection rows: two pairs with known player ids/names.
// Surnames (id-sorted): aaaa=Arce, bbbb=Tello -> "arce-tello"
//                       cccc=Galan, dddd=Lebron -> "galan-lebron"
const ROWS = [
  {
    tournament_id: 't1', category: 'men',
    pair_key: 'aaaa::bbbb', pair_player_ids: ['aaaa', 'bbbb'],
    tournament_level: 'fip_platinum', status: 'active', eliminated_round: null,
    champion_prob: 0.4, finalist_prob: 0.6, semifinal_prob: 0.8,
    predicted_finish_round: 'F', rounds: [], computed_at: '2026-06-17T00:00:00Z',
  },
  {
    tournament_id: 't1', category: 'men',
    pair_key: 'cccc::dddd', pair_player_ids: ['cccc', 'dddd'],
    tournament_level: 'fip_platinum', status: 'active', eliminated_round: null,
    champion_prob: 0.2, finalist_prob: 0.3, semifinal_prob: 0.5,
    predicted_finish_round: 'SF', rounds: [], computed_at: '2026-06-17T00:00:00Z',
  },
]

vi.mock('../useProjection', () => ({
  useProjection: () => ({ rows: ROWS, loading: false, error: false }),
}))
vi.mock('../usePairImages', () => ({
  usePairImages: () => new Map([
    ['aaaa', { name: 'Maxi Arce', country: null, avatarUrl: null, photoUrl: null }],
    ['bbbb', { name: 'Juan Tello', country: null, avatarUrl: null, photoUrl: null }],
    ['cccc', { name: 'Ale Galan', country: null, avatarUrl: null, photoUrl: null }],
    ['dddd', { name: 'Juan Lebron', country: null, avatarUrl: null, photoUrl: null }],
  ]),
}))
// next-intl's navigation pulls in `next/navigation`, which vitest can't resolve.
// ProjectionTab only uses `Link` from it; stub the module.
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

import ProjectionTab from '../ProjectionTab'

const messages = { projectionTab: {} as Record<string, string> }
function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} onError={() => {}} getMessageFallback={({ key }) => key}>
      {ui}
    </NextIntlClientProvider>,
  )
}

afterEach(cleanup)

describe('ProjectionTab slug sync', () => {
  it('resolves initialPairSlug to the matching pair and emits its canonical slug', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
        initialPairSlug="arce-tello" onPairSlugChange={onSlug}
      />,
    )
    await waitFor(() => expect(onSlug).toHaveBeenCalledWith('arce-tello'))
  })

  it('resolves a reversed-order slug to the canonical slug', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
        initialPairSlug="tello-arce" onPairSlugChange={onSlug}
      />,
    )
    await waitFor(() => expect(onSlug).toHaveBeenCalledWith('arce-tello'))
  })

  it('emits null when no pair is selected (list view)', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
        initialPairSlug={null} onPairSlugChange={onSlug}
      />,
    )
    await waitFor(() => expect(onSlug).toHaveBeenCalledWith(null))
  })

  it('does not resolve an unknown slug (stays on list, emits null)', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1" matches={[]} category="men"
        tournamentLevel="fip_platinum" roundSchedule={null}
        initialPairSlug="nobody-here" onPairSlugChange={onSlug}
      />,
    )
    await waitFor(() => expect(onSlug).toHaveBeenCalled())
    // Never emitted a real pair slug — only null.
    for (const call of onSlug.mock.calls) expect(call[0]).toBeNull()
  })
})
