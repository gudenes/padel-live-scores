import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { loginWithGoogle } from './actions'
import { LoginForm } from './LoginForm'
import { EmailLinkForm } from './EmailLinkForm'
import styles from './login.module.css'

export const metadata = { title: 'Sign in · PadelNachos Admin' }

export default async function LoginPage() {
 const session = await auth()
 if (session?.user) redirect((session.user.isScouter || session.user.isViewer) && !session.user.isOperator ? '/scouting' : '/today')
 return <main className={styles.page}>
  <section className={styles.hero} aria-label="Our purpose"><div className={styles.heroCopy}><h2>You’re building<br/>the future of padel.</h2><p>Where fan passion meets sports science.</p></div></section>
  <section className={styles.login} aria-labelledby="login-title"><div className={styles.content}>
   <div className={styles.brands}><img className={styles.nachos} src="/scout-web/assets/padelnachos-logo.png" alt="Padel Nachos" width="96" height="70"/><span className={styles.brandDivider} aria-hidden="true"/><img className={styles.labs} src="/brand/padellabs.png" alt="Padel Labs" width="205" height="51"/></div>
   <h1 id="login-title">Welcome back</h1><p className={styles.intro}>Sign in to your admin workspace.</p>
   <form action={loginWithGoogle}><Button type="submit" variant="default" className={`ui-btn ${styles.google}`}><img src="/brand/google.svg" alt="" width="19" height="19"/>Continue with Google</Button></form>
   <div className={styles.divider}>or</div>
   <LoginForm/>
   <details className={styles.emailLink}><summary>Email me a sign-in link</summary><EmailLinkForm/></details>
   <p className={styles.footer}>Authorized team access.</p>
  </div></section>
 </main>
}
