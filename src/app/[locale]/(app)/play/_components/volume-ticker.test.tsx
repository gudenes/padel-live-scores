// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import VolumeTicker from './VolumeTicker'
afterEach(() => { cleanup(); vi.useRealTimers() })
const view = (volume: number) => <NextIntlClientProvider locale="en" messages={messages}><VolumeTicker volume={volume}/></NextIntlClientProvider>
it('announces only new volume and clears the announcement without losing the total', () => {
 vi.useFakeTimers()
 const {rerender} = render(view(1000))
 expect(screen.queryByText(/just played/)).toBeNull()
 rerender(view(1250))
 expect(screen.getByText('+250 G just played')).toBeTruthy()
 act(() => vi.advanceTimersByTime(2000))
 rerender(view(1250))
 act(() => vi.advanceTimersByTime(1200))
 expect(screen.queryByText(/just played/)).toBeNull()
 expect(screen.getByText(/1,250 G traded/)).toBeTruthy()
})
it('does not turn a correction into new activity', () => {
 const {rerender} = render(view(1000))
 rerender(view(1250))
 rerender(view(900))
 expect(screen.queryByText(/just played/)).toBeNull()
})
