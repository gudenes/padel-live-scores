'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Image from 'next/image'
import { Link, useRouter } from '@/i18n/navigation'
import { betaCopy, type BetaLocale } from '@/lib/beta-copy'
import styles from './signup.module.css'
import { BETA_STARTS_AT, BETA_SIGNUPS_CLOSE_AT, betaSignupsClosed, betaTimeRemaining } from '@/lib/beta-schedule'

const languages = { en: 'English', es: 'Español', pt: 'Português' } as const

function persistLocale(locale: BetaLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

export default function BetaSignup({ locale }: { locale: BetaLocale }) {
  const copy = betaCopy[locale]
  const router = useRouter()
  const busy = useRef(false)
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')

  const [now, setNow] = useState<number | null>(null)
  const [serverClosed, setServerClosed] = useState(false)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [])
  const closed = serverClosed || (now !== null && betaSignupsClosed(now))
  const remaining = now === null ? null : betaTimeRemaining(now)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || closed) return
    busy.current = true
    setStatus('pending')
    const data = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/beta/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'), email: data.get('email'),
          language: data.get('language'), locale,
          commitment: data.get('commitment') === 'on',
          contactConsent: data.get('contactConsent') === 'on',
          website: data.get('website'),
        }),
      })
      if (response.status === 410) {
        setServerClosed(true)
        setStatus('idle')
        return
      }
      if (!response.ok) throw new Error('signup_failed')
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      busy.current = false
    }
  }

  return (
    <main className={styles.page} lang={locale}>
      <header className={styles.header}>
        <Link href="/home" className={styles.brand}>
          <Image src="/padelnachos-logo-v2.png" alt="Padel Nachos" width={112} height={80} priority />
        </Link>
        <nav className={styles.languages} aria-label="Language / Idioma">
          {(Object.keys(languages) as BetaLocale[]).map(language => (
            <button key={language} type="button" aria-pressed={locale === language}
              lang={language} disabled={status === 'pending'} onClick={() => {
                persistLocale(language)
                router.replace('/beta', { locale: language, scroll: false })
              }}>{languages[language]}</button>
          ))}
        </nav>
      </header>

      <div className={styles.layout}>
        <section className={styles.introduction}>
          <p className={styles.eyebrow}><span />{copy.label}</p>
          <p className={styles.product}>Padel Predictor Market</p>
          <h1>{copy.title}</h1>
          <div className={styles.campaignDates}>
            <time dateTime={BETA_STARTS_AT}>{copy.starts}</time>
            <span>{copy.duration}</span>
          </div>
          <div className={styles.countdown}>
            <span>{closed ? copy.closed : copy.closes}</span>
            {!closed && <time dateTime={BETA_SIGNUPS_CLOSE_AT} role="timer" aria-live="off">
              {remaining ? `${remaining.days}${copy.days} : ${String(remaining.hours).padStart(2, '0')}${copy.hours} : ${String(remaining.minutes).padStart(2, '0')}${copy.minutes} : ${String(remaining.seconds).padStart(2, '0')}${copy.seconds}` : '—'}
            </time>}
          </div>
          {!closed && <a className={styles.heroCta} href="#beta-signup">{copy.jump} <span aria-hidden="true">↗</span></a>}
          <figure className={styles.marketPreview}>
            <h2>{copy.preview}</h2>
            <Image src="/beta/market-preview.png" alt={copy.preview} width={1202} height={1309} sizes="(max-width: 780px) 400px, 540px" priority />
            <figcaption>{copy.previewNote}</figcaption>
          </figure>
          <p className={styles.intro}>{copy.intro}</p>
          <div className={styles.details}>
            {[
              ['03', copy.duration, copy.durationText],
              ['15′', copy.feedback, copy.feedbackText],
            ].map(([number, title, text]) => (
              <section key={number} className={styles.detail}>
                <span className={styles.number} aria-hidden="true">{number}</span>
                <div><h2>{title}</h2><p>{text}</p></div>
              </section>
            ))}
          </div>
          <section className={styles.reward} aria-label={copy.reward}>
            <div className={styles.rewardTop}>
              <span>{copy.rewardLabel}</span>
              <span className={styles.proLabel}>PRO</span>
            </div>
            <div className={styles.rewardMain}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="m3 6 4 4 5-7 5 7 4-4-3 12H6L3 6Zm3 15h12" strokeLinejoin="round" />
              </svg>
              <h2>{copy.proYear}</h2>
            </div>
            <p>{copy.rewardText}</p>
            <div className={styles.badge}>
              <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true"><path d="m11 1 9 4v9c0 5-9 10-9 10S2 19 2 14V5l9-4Z" stroke="currentColor" strokeWidth="1.5"/><path d="m6 12 3 3 6-6" stroke="currentColor" strokeWidth="2"/></svg>
              {copy.badge}
            </div>
          </section>
        </section>

        <section id="beta-signup" className={styles.card} aria-labelledby="signup-title">
          {status === 'success' ? (
            <div className={styles.success} role="status">
              <span className={styles.check} aria-hidden="true">✓</span>
              <h2 id="signup-title">{copy.successTitle}</h2>
              <p>{copy.success}</p>
              <Link href="/home">{copy.home} →</Link>
            </div>
          ) : closed ? (
            <div className={styles.success} role="status">
              <h2 id="signup-title">{copy.closed}</h2>
              <p>{copy.closedText}</p>
            </div>
          ) : (
            <>
              <h2 id="signup-title">{copy.formTitle}</h2>
              <p className={styles.formIntro}>{copy.formIntro}</p>
              <form onSubmit={submit} aria-busy={status === 'pending'}>
                <fieldset disabled={status === 'pending'} className={styles.fields}>
                  <label htmlFor="beta-name">{copy.name}
                    <input id="beta-name" name="name" autoComplete="given-name" required maxLength={80} />
                  </label>
                  <label htmlFor="beta-email">{copy.email}
                    <input id="beta-email" name="email" type="email" autoComplete="email" required maxLength={254} />
                  </label>
                  <label htmlFor="beta-language">{copy.language}
                    <select id="beta-language" name="language" defaultValue={locale}>
                      {Object.entries(languages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <div className={styles.trap} aria-hidden="true">
                    <label htmlFor="beta-website">Website</label>
                    <input id="beta-website" name="website" tabIndex={-1} autoComplete="off" />
                  </div>
                  <label className={styles.checkbox}>
                    <input name="commitment" type="checkbox" required /><span>{copy.commitment}</span>
                  </label>
                  <label className={styles.checkbox}>
                    <input name="contactConsent" type="checkbox" required /><span>{copy.contact}</span>
                  </label>
                  {status === 'error' && <p role="alert" className={styles.error}>{copy.error}</p>}
                  <button className={styles.submit} type="submit">{status === 'pending' ? copy.submitting : copy.submit}<span aria-hidden="true">→</span></button>
                </fieldset>
              </form>
              <Link href="/privacy" className={styles.privacy}>{copy.privacy}</Link>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
