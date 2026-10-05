'use client'

import { useSyncExternalStore, useCallback, useId } from 'react'
import { outfitStorageKey, parseOutfit, splitPlayerLook, type PlayerOutfit, playerImageSrc } from '@/lib/player-outfit'

import {usesA01Artwork} from '@/lib/avatar-a01'
import {renderAvatar} from '@/lib/avatar-a01-renderer.mjs'
import {useAvatarArtVersion} from '@/hooks/useAvatarArtVersion'
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
export function PlayerFigure({ outfit, className, label = '', portrait = false, approvedArtwork = process.env.NODE_ENV === 'development', wardrobe }: { outfit: PlayerOutfit; className?: string; label?: string; portrait?: boolean; approvedArtwork?: boolean; wardrobe?: Record<string,string> }) {
  const id = useId().replace(/:/g, '')
  const look=splitPlayerLook(outfit)
  const custom=look.face.startsWith('custom:')
  const source=custom?playerImageSrc(look.face):null
  const artVersion=useAvatarArtVersion(source)
  if(custom&&(artVersion==='loading'||artVersion==='error'))return <span className={className} role="status" aria-label={artVersion==='loading'?'Loading avatar':'Avatar unavailable'}/>
  if((approvedArtwork && usesA01Artwork(look.face))||artVersion==='a01-v1')return <span className={className} style={{display:'block',width:'100%',height:'100%'}} dangerouslySetInnerHTML={{__html:renderAvatar({avatar:custom?'face-06':look.face,customSource:source??undefined,id:`portrait-${id}`,portrait,base:'/play/avatars/a01-local/',outfit:wardrobe ?? (look.clothes==='starter'?{}:{shirt:look.clothes==='court-club'?'club':'cobalt',shorts:look.clothes==='court-club'?'club':'cobalt'})}).replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}}/>
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
export function PlayerAvatar({ outfit, size = 44, approvedArtwork, wardrobe }: { outfit: PlayerOutfit; size?: number; approvedArtwork?: boolean; wardrobe?: Record<string,string> }) {
  return <span style={{ width: size, height: size, display: 'inline-block', overflow: 'hidden', borderRadius: '50%', background: '#20211e', position: 'relative', flexShrink: 0 }}>
    <PlayerFigure outfit={outfit} portrait approvedArtwork={approvedArtwork} wardrobe={wardrobe} />
  </span>
}
