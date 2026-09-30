'use client'

import { useSyncExternalStore, useCallback, useId } from 'react'
import { outfitStorageKey, parseOutfit, type PlayerOutfit } from '@/lib/player-outfit'

import { PLAYER_RIG, playerArtwork } from '@/lib/player-rig'

const event = 'pn-outfit-change'
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(event, callback)
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(event, callback) }
}
export function usePlayerOutfit(userId?: string) {
  const getSnapshot = useCallback(() => {
    if (!userId) return null
    try { return parseOutfit(localStorage.getItem(outfitStorageKey(userId))) } catch { return null }
  }, [userId])
  const outfit = useSyncExternalStore(subscribe, getSnapshot, () => null)
  function save(next: PlayerOutfit | null) {
    if (!userId) return false
    try {
      if (next) localStorage.setItem(outfitStorageKey(userId), next)
      else localStorage.removeItem(outfitStorageKey(userId))
      window.dispatchEvent(new Event(event))
      return true
    } catch { return false }
  }
  return { outfit, save }
}
/** All layers use artwork coordinates, so resizing cannot detach the neck. */
export function PlayerFigure({ outfit, className, label = '', portrait = false }: { outfit: PlayerOutfit; className?: string; label?: string; portrait?: boolean }) {
  const id = useId().replace(/:/g, '')
  const artwork = playerArtwork(outfit)
  return <svg className={className} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} viewBox={portrait ? '200 20 620 650' : `0 0 ${PLAYER_RIG.width} ${PLAYER_RIG.height}`} style={{ display: 'block', width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
    {artwork.kind === 'whole' ? <image href={artwork.image} width="1024" height="1536" /> : <>
      <defs>
        <clipPath id={`${id}-body`}><rect x="0" y={artwork.bodyTop} width="1024" height={1536 - artwork.bodyTop} /></clipPath>
        <clipPath id={`${id}-head`}><rect width="1024" height={artwork.headBottom} /></clipPath>
      </defs>
      <image href={artwork.body} width="1024" height="1536" clipPath={`url(#${id}-body)`} />
      <image href={artwork.head} width="1024" height="1536" clipPath={`url(#${id}-head)`} />
    </>}
  </svg>
}
export function PlayerAvatar({ outfit, size = 44 }: { outfit: PlayerOutfit; size?: number }) {
  return <span style={{ width: size, height: size, display: 'inline-block', overflow: 'hidden', borderRadius: '50%', background: '#20211e', position: 'relative', flexShrink: 0 }}>
    <PlayerFigure outfit={outfit} portrait />
  </span>
}
