// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { MatchVoteCard } from '../MatchVoteCard'

afterEach(cleanup)

const messages = { prediction: {
  whoWillWin: 'Who will win?', castVote: 'Cast your vote',
  fansVoted: '{count} fans voted', yourPick: 'you',
} }

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)
}

describe('MatchVoteCard', () => {
  it('shows two vote buttons before voting', () => {
    wrap(<MatchVoteCard pair1Label="Galán/Chingotto" pair2Label="Tapia/Coello"
      yourPick={null} aggregate={null} locked={false} onVote={() => {}} />)
    expect(screen.getByRole('button', { name: /Galán\/Chingotto/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tapia\/Coello/ })).toBeTruthy()
  })

  it('calls onVote with the chosen pair', () => {
    const onVote = vi.fn()
    wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={null} aggregate={null} locked={false} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /C\/D/ }))
    expect(onVote).toHaveBeenCalledWith(2)
  })

  it('reveals the community split after voting', () => {
    wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={1} aggregate={{ pair1: 68, pair2: 32, total: 100 }} locked={false} onVote={() => {}} />)
    expect(screen.getByText('68%')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
  })

  it('locked with votes shows split read-only, no buttons', () => {
    wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={null} aggregate={{ pair1: 7, pair2: 3, total: 10 }} locked={true} onVote={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('70%')).toBeTruthy()
  })

  it('locked with zero votes renders nothing', () => {
    const { container } = wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={null} aggregate={{ pair1: 0, pair2: 0, total: 0 }} locked={true} onVote={() => {}} />)
    expect(container.textContent).toBe('')
  })
})
