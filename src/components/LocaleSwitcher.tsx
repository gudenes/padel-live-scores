'use client'
// src/components/LocaleSwitcher.tsx
//
// Language switcher — circular flag button that opens a dropdown
// showing all available languages. Tap a flag to switch.

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

const LOCALE_FLAGS: Record<string, { code: string; label: string }> = {
  en: { code: 'gb', label: 'English' },
  es: { code: 'es', label: 'Español' },
  pt: { code: 'br', label: 'Português' },
  it: { code: 'it', label: 'Italiano' },
}

interface LocaleSwitcherProps {
  /** Size in px (default 28) */
  size?: number
}

export default function LocaleSwitcher({ size = 28 }: LocaleSwitcherProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick as EventListener)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick as EventListener)
    }
  }, [open])

  const handleSelect = (loc: string) => {
    if (loc === locale) {
      setOpen(false)
      return
    }
    setOpen(false)
    router.replace(pathname, { locale: loc })
  }

  const current = LOCALE_FLAGS[locale] ?? LOCALE_FLAGS.en

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Current flag button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label="Change language"
        aria-expanded={open}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: open ? '2px solid rgba(126,211,33,0.4)' : '2px solid rgba(255,255,255,0.12)',
          cursor: 'pointer',
          overflow: 'hidden',
          padding: 0,
          background: '#222',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.2s',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://flagcdn.com/w80/${current.code}.png`}
          alt={current.label}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: size + 6,
          right: 0,
          background: '#1A1A1A',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 12,
          padding: 4,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          animation: 'locale-dropdown-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          minWidth: 140,
        }}>
          {routing.locales.map(loc => {
            const flag = LOCALE_FLAGS[loc] ?? LOCALE_FLAGS.en
            const isActive = loc === locale
            return (
              <button
                key={loc}
                onClick={() => handleSelect(loc)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: isActive ? 'rgba(126,211,33,0.08)' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  width: '100%',
                  transition: 'background 0.15s',
                }}
              >
                {/* Flag circle */}
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: isActive ? '2px solid rgba(126,211,33,0.4)' : '2px solid rgba(255,255,255,0.08)',
                  flexShrink: 0,
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://flagcdn.com/w80/${flag.code}.png`}
                    alt={flag.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                {/* Label */}
                <span style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#7ED321' : '#9AAEC4',
                }}>
                  {flag.label}
                </span>
                {/* Check for active */}
                {isActive && (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes locale-dropdown-in {
          0% { opacity: 0; transform: scale(0.9) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}} />
    </div>
  )
}
