// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import RankingInfo from './RankingInfo'
afterEach(cleanup)
it('opens the explanation on tap and closes on Escape or an outside tap',()=>{
 render(<NextIntlClientProvider locale="en" messages={messages}><RankingInfo weekly/></NextIntlClientProvider>)
 const button=screen.getByRole('button')
 fireEvent.click(button)
 expect(button.getAttribute('aria-expanded')).toBe('true')
 expect(screen.getByRole('tooltip').textContent).toContain(messages.play.leaders.weekScope)
 fireEvent.keyDown(document,{key:'Escape'})
 expect(screen.queryByRole('tooltip')).toBeNull()
 fireEvent.click(button)
 fireEvent.pointerDown(document.body)
 expect(screen.queryByRole('tooltip')).toBeNull()
})
