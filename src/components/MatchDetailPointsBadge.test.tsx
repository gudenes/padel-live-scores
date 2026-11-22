// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import MatchDetailPointsBadge from './MatchDetailPointsBadge'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const wrap = (node: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>
it('prices a detail-page final with the same main-draw table', () => {
 render(wrap(<MatchDetailPointsBadge matchId="m" level="fip_silver" round="Final" season="2026" />))
 expect(screen.getByRole('button', {name: /80 pts/})).toBeTruthy()
})
it('uses verified qualifying data and never guesses Q1 points', async () => {
 let resolve!: (value: unknown) => void
 vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r })))
 render(wrap(<MatchDetailPointsBadge matchId="m" tournamentId="t" level="major" round="Q1" season="2026" />))
 expect(screen.queryByRole('button')).toBeNull()
 resolve({ok:true,json:async()=>({matches:{m:{winner:15,loser:0,qualifying:true}}})})
 expect(await screen.findByRole('button', {name: /15 pts/})).toBeTruthy()
})
