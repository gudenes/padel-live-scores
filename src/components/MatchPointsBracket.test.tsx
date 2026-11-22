// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import MatchPointsBracket from './MatchPointsBracket'
afterEach(cleanup)
const show = (round: string, nextRound?: string, qualifying = false) => render(<NextIntlClientProvider locale="en" messages={messages}><MatchPointsBracket round={round} nextRound={nextRound} qualifying={qualifying} points={30} loserPoints={15} /></NextIntlClientProvider>)
it('shows a semifinal progressing to the final', () => {
 show('SEMIFINALS')
 expect(screen.getAllByText('Semifinal')).toHaveLength(2)
 expect(screen.getByText('Final')).toBeTruthy()
 expect(screen.getByText('Tournament exit')).toBeTruthy()
})
it('ends a final in the title rather than another round', () => {
 show('Final')
 expect(screen.getByText(/Champions/)).toBeTruthy()
 expect(screen.queryByText('Next round')).toBeNull()
})
it('uses the verified qualifying destination, including main-draw entry', () => {
 show('Q2', 'R32', true)
 expect(screen.getByText('R32')).toBeTruthy()
 expect(screen.getByText('Main draw')).toBeTruthy()
 expect(screen.queryByText('Q3')).toBeNull()
})
it('does not guess the last qualifying round without draw metadata', () => {
 show('Q2', undefined, true)
 expect(screen.getByText('Next round')).toBeTruthy()
 expect(screen.queryByText('Q3')).toBeNull()
})
