'use client'

import AvatarShare from './AvatarShare'
import {ShopProfileFigure} from './shop/AvatarShop'
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
  const shareStage = useRef<HTMLDivElement>(null)
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
  if(access.data !== true)return null
  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroVisual} ref={shareStage}>
      <div className={styles.identity}>
        <span className={styles.eyebrow}>{t('yourPlayer')}</span>
        <h1>{name}</h1>
        {access.data === true ? <div className={styles.balance}>
          {me.data ? <><strong><GuacaCoin size={30} />{number(me.data.balance)}</strong><span>{t('available')}</span></> : <p role="status">{t(me.status === 'error' ? 'loadError' : 'loading')}</p>}
          {me.status === 'error' && <button className={styles.textButton} onClick={me.reload}>{t('retry')}</button>}
        </div> : <p>{t('yourStyle')}</p>}
        {access.data === true ? <a className={styles.shopShortcut} href={`/${locale}/avatar-shop`} aria-label={t('shopEntry')}>
          <span className={styles.shopSymbol} aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.8v1L3 16a1.4 1.4 0 0 0 .7 2.6h16.6A1.4 1.4 0 0 0 21 16l-9-5.5"/><path d="m18 3 .6 1.4L20 5l-1.4.6L18 7l-.6-1.4L16 5l1.4-.6L18 3Z"/></svg></span>
          <span className={styles.shopCopy}><strong>{t('shopTitle')}</strong><span>{t('shopBrowse')} <span aria-hidden="true">↗</span></span></span>
        </a> : <button className={styles.primary} onClick={openWardrobe}>{t('wardrobe')} <span aria-hidden>↗</span></button>}
      </div>
      <div data-avatar-art style={{display:'contents'}}>
      {access.data === true ? <ShopProfileFigure className={styles.character} fallback={<PlayerFigure className={styles.character} outfit={shown} label={t('characterAlt')} />}/> : <PlayerFigure className={styles.character} outfit={shown} label={t('characterAlt')} />}
      </div>
      <span className={styles.outfitName}>{access.data === true ? '' : <>{label(equipped.face)}{canCustomizePlayer(shown) || equipped.face === 'starter' ? ` · ${label(equipped.clothes)}` : ''}</>}</span>
      </div>
      <div className={styles.avatarActions}><AvatarShare stage={shareStage}/></div>
      {access.data === true && me.data && <>
        <div className={styles.summaryMetrics}>
          <div><strong>{number(activePositions.reduce((total, position) => total + position.costBasis, 0))} <GuacaCoin size={18} /></strong><span>{t('invested')}</span></div>
          <button onClick={() => router.push('/play?view=mine')}><strong>{new Set(activePositions.map(p => p.marketId)).size}</strong><span>{t('markets')} ↗</span></button>
          <button onClick={() => router.push('/play?view=leaders')}><strong>{leaders.data?.me ? `#${leaders.data.me.humanRank ?? leaders.data.me.rank}` : '—'}</strong><span>{t('leaderboard')} ↗</span></button>
        </div>
        <button className={styles.summaryLink} onClick={() => router.push(activePositions.length ? '/play?view=mine' : '/play')}>{t(activePositions.length ? 'allPositions' : 'explore')} <span aria-hidden>→</span></button>
      </>}
    </div>
    <p className={styles.status} role="status">{message}</p>
    {access.status === 'error' && <div className={styles.panel}><p>{t('loadError')}</p><button className={styles.secondary} onClick={access.reload}>{t('retry')}</button></div>}
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
