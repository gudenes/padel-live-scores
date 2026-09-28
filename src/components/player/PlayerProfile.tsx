'use client'

import GuacaCoin from '@/components/GuacaCoin'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { PlayerAvatar, PlayerFigure, usePlayerOutfit } from '@/components/PlayerAvatar'
import { canCustomizePlayer } from '@/lib/player-rig'
import PhotoAvatarCreator from './PhotoAvatarCreator'
import { OUTFITS, PLAYER_FACES, splitPlayerLook, withPlayerFace, withPlayerClothes, type PlayerOutfit } from '@/lib/player-outfit'
import { useApiResource } from '@/app/[locale]/(app)/play/_components/usePlayData'
import { parseMe, parseLeaderboard } from '@/app/[locale]/(app)/play/_components/types'
import styles from './PlayerProfile.module.css'

export default function PlayerProfile({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('playerProfile')
  const locale = useLocale()
  const router = useRouter()
  const { outfit, save } = usePlayerOutfit(userId)
  const [draft, setDraft] = useState<PlayerOutfit>('starter')
  const [wardrobeTab, setWardrobeTab] = useState<'faces' | 'photo'>('faces')
  const [generated, setGenerated] = useState<PlayerOutfit | null>(null)
  const [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const access = useApiResource(`/api/play/access?account=${encodeURIComponent(userId)}`, (p: unknown) => (p as { allowed?: boolean }).allowed === true)
  const me = useApiResource(`/api/play/me?locale=${locale}&account=${encodeURIComponent(userId)}`, parseMe, access.data === true, 30_000)
  const leaders = useApiResource(`/api/play/leaderboard?period=season&account=${encodeURIComponent(userId)}`, parseLeaderboard, access.data === true)
  const activePositions = (me.data?.positions ?? []).filter(p => !['settled', 'void'].includes(p.status))
  const number = (n: number) => Math.round(n).toLocaleString(locale)
  const shown = outfit ?? 'starter'
  const selected = splitPlayerLook(draft)
  const equipped = splitPlayerLook(shown)
  const label = (value: PlayerOutfit) => value.startsWith('custom:') ? t('customFace') : value.startsWith('face-') ? t(`faces.${value}`) : t(`outfits.${value}`)
  function openWardrobe() { setDraft(shown); setWardrobeTab('faces'); setMessage(''); dialog.current?.showModal(); requestAnimationFrame(() => dialog.current?.querySelector('[data-face-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })) }
  useEffect(() => {
    if (dialog.current?.open && wardrobeTab === 'faces') {
      dialog.current.querySelector('[data-face-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
  }, [wardrobeTab, selected.face])
  function equip() {
    if (save(draft)) { dialog.current?.close(); setMessage(t('saved')) }
    else setMessage(t('saveError'))
  }
  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.identity}>
        <span className={styles.eyebrow}>{t('yourPlayer')}</span>
        <h1>{name}</h1>
        <p>{t('yourStyle')}</p>
        <button className={styles.primary} onClick={openWardrobe}>{t('wardrobe')} <span aria-hidden>↗</span></button>
      </div>
      <PlayerFigure className={styles.character} outfit={shown} label={t('characterAlt')} />
      <span className={styles.outfitName}>{label(equipped.face)}{canCustomizePlayer(shown) || equipped.face === 'starter' ? ` · ${label(equipped.clothes)}` : ''}</span>
    </div>
    <p className={styles.status} role="status">{message}</p>
    {access.status === 'error' && <div className={styles.panel}><p>{t('loadError')}</p><button className={styles.secondary} onClick={access.reload}>{t('retry')}</button></div>}
    {access.data === true && <div className={styles.panel}>
      <div className={styles.row}><h2>{t('predictor')}</h2><button className={styles.textButton} onClick={() => router.push('/play?view=leaders')}>{t('leaderboard')} ↗</button></div>
      {me.status === 'loading' && <p role="status">{t('loading')}</p>}
      {me.status === 'error' && <><p>{t('loadError')}</p><button className={styles.secondary} onClick={me.reload}>{t('retry')}</button></>}
      {me.data && <>
        <div className={styles.balance}><strong>{number(me.data.balance)} <GuacaCoin size={36} /></strong><span>{t('available')}</span></div>
        <div className={styles.metrics}>
          <div><strong>{number(activePositions.reduce((total, position) => total + position.costBasis, 0))} <GuacaCoin size={20} /></strong><span>{t('invested')}</span></div>
          <div><strong>{new Set(activePositions.map(p => p.marketId)).size}</strong><span>{t('markets')}</span></div>
          <div><strong>{leaders.data?.me ? `#${leaders.data.me.humanRank ?? leaders.data.me.rank}` : '—'}</strong><span>{t('seasonRank')}</span></div>
        </div>
        <div className={styles.positions}>
          {activePositions.slice(0, 2).map(p => <button key={`${p.marketId}-${p.side}`} className={styles.position} onClick={() => router.push('/play?view=mine')}>
            <span className={styles.side} data-side={p.side}>{t(p.side)}</span><span>{p.question}<small>{number(p.costBasis)} G · {t('invested')}</small></span><span aria-hidden>›</span>
          </button>)}
          {!activePositions.length && <p>{t('empty')}</p>}
        </div>
        <button className={styles.primary} onClick={() => router.push('/play')}>{t('explore')} <span aria-hidden>→</span></button>
        {!!activePositions.length && <button className={styles.textButton} style={{ width: '100%', marginTop: 12 }} onClick={() => router.push('/play?view=mine')}>{t('allPositions')} →</button>}
      </>}
    </div>}
    <dialog onClose={() => setWardrobeTab('faces')} aria-label={t('wardrobe')} ref={dialog} className={styles.dialog} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <div className={styles.wardrobe}>
        <div className={styles.row}><h2>{t('wardrobe')}</h2><button className={styles.close} aria-label={t('close')} onClick={() => dialog.current?.close()}>×</button></div>
        {wardrobeTab !== 'photo' && <div className={styles.preview}>
          <PlayerFigure className={styles.figurePreview} outfit={draft} label={label(selected.face)} />
          <div className={styles.portrait}><PlayerAvatar outfit={draft} size={60} /><span>{t('avatarPreview')}</span></div>
        </div>}
        {wardrobeTab !== 'photo' && <>
          <div className={styles.selectionHeading}><strong>{label(selected.face)}</strong><span>{t('tabs.faces')}</span></div>
          <div className={styles.faceRail} role="group" aria-label={t('tabs.faces')}>
            {[...PLAYER_FACES, ...(generated ? [generated] : equipped.face.startsWith('custom:') ? [equipped.face] : [])].map(item => <button key={item} aria-label={label(item)} aria-pressed={selected.face === item} data-face-selected={selected.face === item} className={styles.faceChoice} onClick={() => setDraft(withPlayerFace(draft, item))}>
              <PlayerAvatar outfit={withPlayerFace(draft, item)} size={54} /><span>{label(item)}</span>
            </button>)}
          </div>
          {canCustomizePlayer(draft) && <div className={styles.swatches} role="group" aria-label={t('tabs.looks')}>
            {OUTFITS.map(item => <button key={item} className={styles.swatch} data-outfit={item} aria-pressed={selected.clothes === item} onClick={() => setDraft(withPlayerClothes(draft, item))}><span className={styles.fabric} aria-hidden="true" /><span>{label(item)}</span><span className={styles.selectedTick} aria-hidden="true">{selected.clothes === item ? '✓' : ''}</span></button>)}
          </div>}
          <button className={styles.photoEntry} onClick={() => setWardrobeTab('photo')}><span aria-hidden="true">＋</span> {t('tabs.photo')} <span aria-hidden="true">↗</span></button>
        </>}
        {wardrobeTab === 'photo' && <button className={styles.textButton} onClick={() => setWardrobeTab('faces')}>← {t('wardrobe')}</button>}
        {wardrobeTab === 'photo' && <PhotoAvatarCreator onPreview={value => { setGenerated(value); setDraft(withPlayerFace(draft, value)); setWardrobeTab('faces'); setMessage(t('previewReady')) }} />}
        {wardrobeTab !== 'photo' && <div className={styles.saveBar}><button className={styles.primary} onClick={equip}>{t('equip')} <span aria-hidden>✓</span></button><p className={styles.saveNote}>{t(canCustomizePlayer(draft) ? 'localNote' : 'creator.whole')}</p></div>}
        {wardrobeTab !== 'photo' && outfit && <button className={styles.textButton} style={{ width: '100%', marginTop: 12 }} onClick={() => { if (save(null)) { dialog.current?.close(); setMessage(t('restored')) } else setMessage(t('saveError')) }}>{t('restore')}</button>}
        <p role="status" className={styles.status}>{message}</p>
      </div>
    </dialog>
  </section>
}
