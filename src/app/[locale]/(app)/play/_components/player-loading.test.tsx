// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
vi.stubGlobal('React',React)
vi.mock('@/components/nav/GlobalHeader',()=>({default:()=> <header>Header</header>}))
import PlayerLoading from './PlayerLoading'
afterEach(()=>{cleanup();vi.useRealTimers()})
it('explains a slow load without inventing a progress percentage',()=>{
 vi.useFakeTimers()
 render(<NextIntlClientProvider locale="en" messages={messages}><PlayerLoading/></NextIntlClientProvider>)
 expect(screen.getByRole('status').textContent).toBe(messages.play.onboarding.loading)
 expect(screen.getByText(messages.play.onboarding.loadingHint)).toBeTruthy()
 act(()=>vi.advanceTimersByTime(8000))
 expect(screen.getByText(messages.play.onboarding.loadingSlow)).toBeTruthy()
 expect(screen.queryByRole('progressbar')).toBeNull()
})
it('replaces the loading state with an actionable retry on failure',()=>{
 const retry=vi.fn()
 render(<NextIntlClientProvider locale="en" messages={messages}><PlayerLoading error onRetry={retry}/></NextIntlClientProvider>)
 expect(screen.getByRole('alert').textContent).toBe(messages.play.onboarding.loadError)
 fireEvent.click(screen.getByRole('button',{name:messages.play.error.retry}))
 expect(retry).toHaveBeenCalledOnce()
})
