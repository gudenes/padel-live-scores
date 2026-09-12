'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

export type SoundName =
  | 'tap' | 'confirm' | 'swoosh-flat' | 'swoosh-lob' | 'swoosh-smash'
  | 'correct' | 'wrong' | 'continue' | 'complete'

const SOUND_PATHS: Record<SoundName, string> = {
  tap:            '/padelgenius/sounds/tap.mp3',
  confirm:        '/padelgenius/sounds/confirm.mp3',
  'swoosh-flat':  '/padelgenius/sounds/swoosh-flat.mp3',
  'swoosh-lob':   '/padelgenius/sounds/swoosh-lob.mp3',
  'swoosh-smash': '/padelgenius/sounds/swoosh-smash.mp3',
  correct:        '/padelgenius/sounds/correct.mp3',
  wrong:          '/padelgenius/sounds/wrong.mp3',
  continue:       '/padelgenius/sounds/continue.mp3',
  complete:       '/padelgenius/sounds/complete.mp3',
}

const STORAGE_KEY = 'padelgenius:muted'

export function usePadelgeniusSound() {
  const cacheRef = useRef<Partial<Record<SoundName, HTMLAudioElement>>>({})
  const [muted, setMutedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  // Preload on mount — defensive: tolerate missing/invalid audio files
  useEffect(() => {
    (Object.keys(SOUND_PATHS) as SoundName[]).forEach(name => {
      try {
        const a = new Audio(SOUND_PATHS[name])
        a.preload = 'auto'
        // If the file is missing or invalid, drop from cache so play() short-circuits.
        a.addEventListener('error', () => { delete cacheRef.current[name] }, { once: true })
        cacheRef.current[name] = a
      } catch {/* ignore — SSR or constructor failure */}
    })
  }, [])

  const play = useCallback((name: SoundName) => {
    if (muted) return
    const a = cacheRef.current[name]
    if (!a) return
    try {
      a.currentTime = 0
      void a.play()
    } catch {/* ignore */}
  }, [muted])

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    }
  }, [])

  return { play, muted, setMuted, toggleMuted: () => setMuted(!muted) }
}
