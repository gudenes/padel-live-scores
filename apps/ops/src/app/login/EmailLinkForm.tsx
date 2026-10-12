'use client'
import {useActionState} from 'react'
import {Button} from '@/components/ui'
import {loginWithEmailLink,type EmailLinkState} from './actions'
export function EmailLinkForm(){
  const [state,action,pending]=useActionState<EmailLinkState,FormData>(loginWithEmailLink,undefined)
  return <form action={action} style={{display:'flex',flexDirection:'column',gap:10}}>
    <label htmlFor="magic-link-email" style={{fontSize:13}}>Email for sign-in link</label>
    <input id="magic-link-email" name="email" type="email" required autoComplete="email" className="ui-input" disabled={pending} aria-describedby={state?.error?'magic-link-error':undefined}/>
    {state?.error&&<p id="magic-link-error" role="alert" style={{margin:0,fontSize:13,color:'var(--live-text)'}}>{state.error}</p>}
    <Button type="submit" variant="default" disabled={pending}>{pending?'Sending sign-in link…':'Email me a sign-in link'}</Button>
  </form>
}
