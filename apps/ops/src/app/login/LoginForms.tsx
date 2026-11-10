'use client'
import {useState} from 'react'
import {LoginForm} from './LoginForm'
import {EmailLinkForm} from './EmailLinkForm'
import styles from './login.module.css'

export function LoginForms() {
 const [email,setEmail]=useState('')
 return <>
  <LoginForm email={email} onEmailChange={setEmail}/>
  <details className={styles.emailLink}><summary>Email me a sign-in link</summary><EmailLinkForm email={email} onEmailChange={setEmail}/></details>
 </>
}
