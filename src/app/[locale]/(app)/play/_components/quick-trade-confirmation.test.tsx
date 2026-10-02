// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import QuickTradeConfirmation from './QuickTradeConfirmation'
afterEach(() => { cleanup(); vi.useRealTimers() })
const trade = {side:'yes' as const, question:'Will the team win?', cost:100, shares:150, avgPrice:.67}
it('shows success briefly then returns once', () => {
 vi.useFakeTimers()
 const onDone = vi.fn()
 render(<NextIntlClientProvider locale="en" messages={messages}><QuickTradeConfirmation trade={trade} onDone={onDone}/></NextIntlClientProvider>)
 expect(screen.getByRole('status').textContent).toContain('100')
 act(() => vi.advanceTimersByTime(3099))
 expect(onDone).not.toHaveBeenCalled()
 act(() => vi.advanceTimersByTime(1))
 expect(onDone).toHaveBeenCalledTimes(1)
})
it('cancels the return when the user leaves', () => {
 vi.useFakeTimers()
 const onDone=vi.fn()
 const {unmount}=render(<NextIntlClientProvider locale="en" messages={messages}><QuickTradeConfirmation trade={trade} onDone={onDone}/></NextIntlClientProvider>)
 unmount()
 act(() => vi.advanceTimersByTime(4000))
 expect(onDone).not.toHaveBeenCalled()
})
