'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import type { BetaLocale } from '@/lib/beta-copy'
import styles from './mini-game.module.css'

const words = {
  es: { demo: 'DEMO · SIN DINERO REAL', balance: 'Guacas de demo', skip: 'Inscribirme', step: 'Paso', back: 'Volver', question: '¿Habrá un tercer set?', context: 'Partido de ejemplo', pick: 'Tu primera jugada. El juego lo construimos contigo.', yes: 'Sí', no: 'No', amount: 'Pon tus Guacas en juego.', amountHint: 'Elige una cantidad virtual para esta demo.', selection: 'Tu predicción', stake: 'Guacas elegidas', possible: 'Retorno si aciertas', review: 'Tu jugada está lista.', reviewHint: 'Ahora descubre cómo sería el resultado.', reveal: 'Ver resultado de ejemplo', won: '¡Has acertado!', lost: 'Esta vez no ha sido.', outcome: 'Resultado de ejemplo: el partido llegó al tercer set.', resultNote: 'Es una simulación. No se guarda ninguna jugada ni se entregan premios.', board: 'Así se vería la clasificación', sample: 'Clasificación de ejemplo', you: 'Tú · demo', join: 'Quiero ayudar a crear el juego', invite: 'Tu opinión cuenta. Juega 3 semanas desde el 10 de octubre y cuéntanos qué mejorar en una charla de 15 minutos.', footer: 'Partido, saldo y multiplicadores de ejemplo.', next: 'Conoce las Guacas', coinHelp: 'Las Guacas son la moneda virtual de Padel Predict.', total: 'Tu saldo de demo', restart: 'Volver a probar' },
  en: { demo: 'DEMO · NO REAL MONEY', balance: 'Demo Guacas', skip: 'Sign up', step: 'Step', back: 'Back', question: 'Will there be a third set?', context: 'Sample match', pick: 'Your first prediction. Help us shape what comes next.', yes: 'Yes', no: 'No', amount: 'Put your Guacas in play.', amountHint: 'Pick a virtual amount for this demo.', selection: 'Your prediction', stake: 'Guacas selected', possible: 'Return if correct', review: 'Your prediction is ready.', reviewHint: 'Discover what the result could look like.', reveal: 'Reveal example result', won: 'You got it right!', lost: 'Not this time.', outcome: 'Example result: the match went to a third set.', resultNote: 'This is a simulation. No plays are saved and no prizes are awarded.', board: 'See your place on the board', sample: 'Sample leaderboard', you: 'You · demo', join: 'Help shape the game', invite: 'Your feedback matters. Play for 3 weeks from October 10, then help us improve the game in a 15-minute chat.', footer: 'Sample match, balance and multipliers.', next: 'Meet Guacas', coinHelp: 'Guacas are the virtual currency in Padel Predict.', total: 'Your demo balance', restart: 'Try again' },
  pt: { demo: 'DEMO · SEM DINHEIRO REAL', balance: 'Guacas de demo', skip: 'Inscrever-me', step: 'Passo', back: 'Voltar', question: 'Haverá um terceiro set?', context: 'Partida de exemplo', pick: 'A tua primeira jogada. Vamos criar o jogo contigo.', yes: 'Sim', no: 'Não', amount: 'Põe as tuas Guacas em jogo.', amountHint: 'Escolhe uma quantia virtual para esta demo.', selection: 'A tua previsão', stake: 'Guacas escolhidas', possible: 'Retorno se acertares', review: 'A tua jogada está pronta.', reviewHint: 'Descobre como seria o resultado.', reveal: 'Ver resultado de exemplo', won: 'Acertaste!', lost: 'Não foi desta vez.', outcome: 'Resultado de exemplo: a partida chegou ao terceiro set.', resultNote: 'É uma simulação. Nenhuma jogada é guardada e não há prémios.', board: 'Vê o teu lugar na classificação', sample: 'Classificação de exemplo', you: 'Tu · demo', join: 'Quero ajudar a criar o jogo', invite: 'A tua opinião conta. Joga 3 semanas a partir de 10 de outubro e ajuda-nos a melhorar numa conversa de 15 minutos.', footer: 'Partida, saldo e multiplicadores de exemplo.', next: 'Conhece as Guacas', coinHelp: 'As Guacas são a moeda virtual do Padel Predict.', total: 'O teu saldo de demo', restart: 'Experimentar novamente' },
} as const

const players = [ ['Tapia', 'Agustin_Tapia_4.png'], ['Coello', 'Arturo_Coello_6.png'], ['Galán', 'Alejandro_Galan_7.png'], ['Chingotto', 'Federico_Chingotto_4.png'] ]

function Coin({ size = 23 }: { size?: number }) {
  return <Image src="/beta/demo/guaca.webp" alt="Guacas" width={size} height={size} style={{ width: size, height: size }} />
}

export default function MiniGame({ locale: initialLocale, signupHref = '/beta#beta-signup' }: { locale: BetaLocale; signupHref?: string }) {
  const [locale, setLocale] = useState(initialLocale)
  const text = words[locale]
  const [step, setStep] = useState(0)
  const [side, setSide] = useState<'yes' | 'no'>('yes')
  const [stake, setStake] = useState(100)
  const [leaving, setLeaving] = useState(false)
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (transition.current) clearTimeout(transition.current) }, [])
  const title = useRef<HTMLHeadingElement>(null)
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  const odds = side === 'yes' ? 4.88 : 1.26
  const balance = step === 3 ? 1000 - stake + (side === 'yes' ? stake * odds : 0) : 1000
  function advance(next: number) {
    if (transition.current) return
    setLeaving(true)
    transition.current = setTimeout(() => {
      setStep(next)
      setLeaving(false)
      transition.current = null
      requestAnimationFrame(() => title.current?.focus())
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140)
  }
  const titles = [text.question, text.amount, text.review, side === 'yes' ? text.won : text.lost]

  return <main className={styles.screen} lang={locale}>
    <header className={styles.header}>
      <div className={styles.brand}><Image src="/beta/demo/padelnachos-logo.png" alt="Padel Nachos" width={1958} height={1402} priority /><div><h1>Padel Predict</h1><p>{text.demo}</p></div></div>
      <div className={styles.headerTools}><nav className={styles.languages} aria-label="Language / Idioma">{(['es','en','pt'] as const).map(code => <button key={code} type="button" aria-label={{es:'Español',en:'English',pt:'Português'}[code]} aria-pressed={locale === code} onClick={() => setLocale(code)}>{code.toUpperCase()}</button>)}</nav><div className={styles.wallet}><span>{text.balance}</span><strong><Coin />{number(balance)}</strong></div></div>
    </header>
    <div className={styles.progress}>
      <span>{text.step} {step + 1} / 4</span>
      <div aria-hidden="true">{[0,1,2,3].map(n => <i key={n} data-done={n <= step} />)}</div>
      {step > 0 ? <button onClick={() => advance(step - 1)} type="button">{text.back}</button> : <Link locale={locale} href={signupHref}>{text.skip}</Link>}
    </div>
    <section key={step} data-leaving={leaving} className={styles.body} aria-labelledby="mini-title">
      <div className={styles.title}><p>{step === 0 ? text.context : step === 1 ? text.next : step === 2 ? text.selection : text.context}</p>
        <h2 id="mini-title" tabIndex={-1} ref={title}>{titles[step]}</h2>
        <p>{step === 0 ? text.pick : step === 1 ? text.amountHint : step === 2 ? text.reviewHint : text.outcome}</p>
      </div>
      {step === 0 && <div className={styles.match}>
        <p className={styles.tournament}>PADEL PREDICT · DEMO</p>
        <div className={styles.players}>{players.map(([name,image], i) => <div key={name} data-side={i < 2 ? 'yes' : 'no'}><Image src={`/beta/demo/${image}`} alt={name} width={100} height={100} /><strong>{name}</strong></div>)}</div>
        <p className={styles.vs}>Tapia / Coello <span>vs</span> Galán / Chingotto</p>
        <div className={styles.choices}>{(['yes','no'] as const).map(value => <button key={value} type="button" data-side={value} onClick={() => {setSide(value);advance(1)}}><span>{text[value]}</span><strong>{number(value === 'yes' ? 4.88 : 1.26)}×</strong></button>)}</div>
      </div>}
      {step === 1 && <div className={styles.amountPanel}>
        <Image className={styles.bigCoin} src="/beta/demo/guaca.webp" alt="Guaca" width={110} height={110} />
        <p>{text.coinHelp}</p>
        <div className={styles.chosen}>{text.selection}: <strong>{text[side]} · {number(odds)}×</strong></div>
        <div className={styles.amounts}>{[50,100,200].map(amount => <button key={amount} type="button" onClick={() => {setStake(amount);advance(2)}}><Coin /><strong>{amount}</strong></button>)}</div>
      </div>}
      {step === 2 && <div className={styles.ticket}>
        <Image className={styles.avatar} src="/beta/demo/face-01.webp" alt="" width={80} height={80} />
        <dl><div><dt>{text.selection}</dt><dd>{text[side]} · {number(odds)}×</dd></div><div><dt>{text.stake}</dt><dd><Coin />{stake}</dd></div><div><dt>{text.possible}</dt><dd><Coin />{number(stake * odds)}</dd></div></dl>
      </div>}
      {step === 3 && <div className={styles.result}>
        <div className={styles.resultBalance}><span>{text.total}</span><strong><Coin size={34}/>{number(balance)}</strong></div>
        <div className={styles.board}><h3>{text.sample}</h3>
          {[['SmashMaster',2480],['BandejaClub',2150],[text.you,balance]].map(([name,value], i) => <div key={name} data-you={i === 2}><span>{i+1}</span><span className={styles.miniAvatar}><Image src={`/beta/demo/face-0${i+1}.webp`} alt="" width={90} height={90} /></span><strong>{name}</strong><b>{number(Number(value))}</b><Coin size={16}/></div>)}
        </div>
        <p className={styles.resultNote}>{text.resultNote}</p>
      </div>}
    </section>
    <footer key={`footer-${step}`} data-leaving={leaving} className={styles.footer}>
      {step === 2 && <button type="button" className={styles.primary} onClick={() => advance(3)}>{text.reveal} <span aria-hidden="true">→</span></button>}
      {step === 3 && <><p className={styles.invite}>{text.invite}</p><Link locale={locale} className={styles.primary} href={signupHref}>{text.join}<span aria-hidden="true">→</span></Link></>}
      <p>{text.footer}</p>
    </footer>
  </main>
}
