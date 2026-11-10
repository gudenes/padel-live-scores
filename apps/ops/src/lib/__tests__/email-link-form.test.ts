// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
const mock=vi.hoisted(()=>({action:vi.fn()}))
vi.mock('../../app/login/actions',()=>({loginWithEmailLink:mock.action,loginWithCredentials:vi.fn()}))
import {LoginForms} from '../../app/login/LoginForms'
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('keeps the form available with an actionable alert after delivery fails',async()=>{
 mock.action.mockResolvedValue({error:'We couldn’t send your sign-in email. Please try again or continue with Google.'})
 render(createElement(LoginForms))
 fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'person@example.com'}})
 fireEvent.click(screen.getByText('Email me a sign-in link',{selector:'summary'}))
 expect((screen.getByLabelText('Email for sign-in link') as HTMLInputElement).value).toBe('person@example.com')
 fireEvent.submit(screen.getByRole('button',{name:'Email me a sign-in link'}).closest('form')!)
 expect((await screen.findByRole('alert')).textContent).toContain('continue with Google')
 expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('person@example.com')
 expect((screen.getByLabelText('Email for sign-in link') as HTMLInputElement).value).toBe('person@example.com')
 expect(mock.action.mock.calls[0][1].get('email')).toBe('person@example.com')
 expect(screen.getByRole('button',{name:'Email me a sign-in link'}).hasAttribute('disabled')).toBe(false)
 expect(screen.getByLabelText('Email for sign-in link').getAttribute('aria-describedby')).toBe('magic-link-error')
})

it('shares corrections from the email-link field with password sign-in',()=>{
 render(createElement(LoginForms))
 fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'first@example.com'}})
 fireEvent.click(screen.getByText('Email me a sign-in link',{selector:'summary'}))
 fireEvent.change(screen.getByLabelText('Email for sign-in link'),{target:{value:'corrected@example.com'}})
 expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('corrected@example.com')
})
