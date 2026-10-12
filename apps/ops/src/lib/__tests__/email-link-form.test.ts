// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
const mock=vi.hoisted(()=>({action:vi.fn()}))
vi.mock('../../app/login/actions',()=>({loginWithEmailLink:mock.action}))
import {EmailLinkForm} from '../../app/login/EmailLinkForm'
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('keeps the form available with an actionable alert after delivery fails',async()=>{
 mock.action.mockResolvedValue({error:'We couldn’t send your sign-in email. Please try again or continue with Google.'})
 render(createElement(EmailLinkForm))
 fireEvent.change(screen.getByLabelText('Email for sign-in link'),{target:{value:'person@example.com'}})
 fireEvent.submit(screen.getByRole('button',{name:'Email me a sign-in link'}).closest('form')!)
 expect((await screen.findByRole('alert')).textContent).toContain('continue with Google')
 expect(screen.getByRole('button',{name:'Email me a sign-in link'}).hasAttribute('disabled')).toBe(false)
 expect(screen.getByLabelText('Email for sign-in link').getAttribute('aria-describedby')).toBe('magic-link-error')
})
