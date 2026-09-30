'use client'

import { useEffect, useId, useState } from 'react'
import styles from './WardrobeLab.module.css'
import { PlayerAvatar } from '@/components/PlayerAvatar'

const AVATARS = [{id: 'face-06', name: 'Nacho'}, {id: 'face-02', name: 'Rayo'}, {id: 'face-08', name: 'Dash'}] as const

// Registered artwork coordinates. Each region can be toggled independently.
const ITEMS = [
  { id: 'racket', name: 'Racket', item: 'Lime Strike', color: '#88da17', path: 'M65 650H310L335 880L340 948L405 980L402 1040L320 1030L265 970H65Z' },
  { id: 'shoes', name: 'Shoes', item: 'Court Sprint', color: '#88da17', path: 'M270 1200H845V1410H270Z' },
  { id: 'shorts', name: 'Shorts', item: 'Deep Court', color: '#168b91', path: 'M424 900H690L741 1055L710 1095H390L375 1055Z' },
  { id: 'shirt', name: 'T-shirt', item: 'Orange Rally', color: '#ff7227', path: 'M450 560L610 560L690 620L755 780L700 805L708 917Q560 945 410 920L407 800L330 766L330 700L377 620Z' },
  { id: 'wrist', name: 'Wristband', item: 'Match Point', color: '#88da17', path: 'M704 877L777 847L801 914L731 944Z' },
  { id: 'hat', name: 'Hat', item: 'Club Cap', color: '#88da17', path: 'M250 20H780V325H250Z' },
] as const

type Slot = typeof ITEMS[number]['id']
const ALL = ITEMS.map(item => item.id)

export default function WardrobeLab() {
  const [avatar, setAvatar] = useState<typeof AVATARS[number]>(AVATARS[0])
  const artwork = `/play/avatars/swap-lab/${avatar.id === 'face-06' ? 'alternate' : avatar.id}.webp`
  const [equipped, setEquipped] = useState<Slot[]>([])
  const [selected, setSelected] = useState<Slot>('racket')
  const [original, setOriginal] = useState(false)
  const [loadedArtwork, setLoadedArtwork] = useState('')
  const loaded = loadedArtwork === artwork
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const image = new Image()
    image.onload = () => setLoadedArtwork(artwork)
    image.onerror = () => setFailed(true)
    image.src = artwork
    return () => { image.onload = null; image.onerror = null }
  }, [artwork])
  const prefix = useId().replace(/:/g, '')
  const item = ITEMS.find(item => item.id === selected)!
  const on = equipped.includes(selected)
  const toggle = (slot: Slot) => {
    setSelected(slot)
    setOriginal(false)
    setEquipped(current => current.includes(slot) ? current.filter(id => id !== slot) : [...current, slot])
  }
  return <main className={styles.lab}>
    <header className={styles.header}><div><span>PLAYER LAB · LOCAL PREVIEW</span><h1>Make it yours.</h1></div><a href="avatar-shop">Open shop ↗</a></header>
    <div className={styles.avatarRail} role="group" aria-label="Choose test avatar">{AVATARS.map(a => <button key={a.id} aria-pressed={avatar.id === a.id} onClick={() => { setAvatar(a); setFailed(false); setOriginal(false) }}><PlayerAvatar outfit={a.id} size={48} /><span>{a.name}</span></button>)}</div>
    <div className={styles.layout}>
      <section className={styles.stage} aria-label="Live outfit preview">
        <span className={styles.counter} role="status">{original ? 'Original outfit' : `${equipped.length} / 6 equipped`}</span>
        <svg viewBox="0 0 1024 1536" role="img" aria-label={`${avatar.name} wearing ${original || !equipped.length ? 'the starter outfit' : ITEMS.filter(i => equipped.includes(i.id)).map(i => i.item).join(', ')}`}>
          <defs>{ITEMS.map(i => <clipPath key={i.id} id={`${prefix}-${i.id}`}><path d={i.id === 'hat' && avatar.id !== 'face-06' ? 'M250 20H780V390H700V350H410V405H250Z' : i.path} /></clipPath>)}</defs>
          <image href={`/play/avatars/${avatar.id}.webp`} width="1024" height="1536" />
          {!original && loaded && ITEMS.filter(i => equipped.includes(i.id)).map(i => <image key={i.id} href={artwork} width="1024" height="1536" clipPath={`url(#${prefix}-${i.id})`} />)}
        </svg>
        <button className={styles.compare} onClick={() => setOriginal(!original)} aria-pressed={original}>{original ? 'Show my outfit' : 'Compare original'}</button>
      </section>
      <section className={styles.controls}>
        <h2>Six slots. Your combination.</h2>
        <p>Tap an item to equip it. Tap again to restore the starter item.</p>
        <div className={styles.slots} role="group" aria-label="Equip items">{ITEMS.map(i => <button key={i.id} onClick={() => toggle(i.id)} disabled={!loaded || failed} aria-pressed={equipped.includes(i.id)}><span className={styles.dot} style={{ background: i.color }} />{i.name}<small>{equipped.includes(i.id) ? '✓' : '+'}</small></button>)}</div>
        <div className={styles.item}><span>{item.name}</span><h3>{item.item}</h3><p>{on ? 'Equipped on your preview' : 'Ready to try'}</p><button className={styles.primary} onClick={() => toggle(selected)} disabled={!loaded || failed}>{failed ? 'Artwork unavailable' : !loaded ? 'Loading artwork…' : on ? 'Use starter item' : 'Try this item'}</button></div>
        <div className={styles.actions}><button disabled={!loaded || failed} onClick={() => { setEquipped([...ALL]); setOriginal(false) }}>Try all six</button><button onClick={() => { setEquipped([]); setOriginal(false) }}>Reset outfit</button></div>
        <p className={styles.note}>Free fitting preview · No Guacas spent.<br />Your selected items carry across all three test avatars. Your saved avatar stays unchanged.</p>

      </section>
    </div>
  </main>
}
