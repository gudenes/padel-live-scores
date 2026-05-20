'use client'
// src/app/[locale]/(app)/rankings/SearchModal.tsx
// Inline search bar (NOT a full-screen modal). Controlled by the
// parent: parent owns the query string and filters the player list
// before passing it to RankingsTable. This component only renders
// the search input + clear/close affordances.

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { BG_CARD, CHUNKY, GREEN, MUTED } from './shared'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
}

export function SearchModal({ query, onQueryChange, onClose }: Props) {
  const t = useTranslations('rankings')
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Autofocus on mount.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={boxRef}
      style={{
        margin: '0 16px',
        padding: '10px 14px',
        background: BG_CARD,
        borderRadius: 4,
        border: '1px solid rgba(126,211,33,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label={t('searchPlaceholder')}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: '#E2E8F0',
          fontSize: 15,
          fontFamily: 'inherit',
        }}
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange('')}
          aria-label={t('clearSearch')}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: MUTED,
            fontSize: 20,
            lineHeight: 1,
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeSearch')}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            cursor: 'pointer',
            color: MUTED,
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1,
            fontFamily: 'inherit',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            clipPath: CHUNKY.badge,
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
