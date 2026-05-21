'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import {
  PWA_NUDGE_EVENT,
  markNudgeShown,
  type PWANudgeTrigger,
} from '@/lib/pwa-install'

const GREEN = '#7ED321'
const BLUE = '#4A9EFF'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
  badge: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
}

export function PWAInstallNudge() {
  const t = useTranslations('consent.pwaInstall')
  const [visible, setVisible] = useState(false)
  const [trigger, setTrigger] = useState<PWANudgeTrigger>('picker')

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent<{ trigger: PWANudgeTrigger }>).detail
      setTrigger(detail?.trigger ?? 'picker')
      setVisible(true)
      // Telemetry — PostHog no-ops gracefully when consent denied.
      try {
        posthog.capture('pwa_install_nudge_shown', {
          trigger: detail?.trigger ?? 'picker',
        })
      } catch {}
    }
    window.addEventListener(PWA_NUDGE_EVENT, onShow)
    return () => window.removeEventListener(PWA_NUDGE_EVENT, onShow)
  }, [])

  if (!visible) return null

  const dismiss = (button: 'maybe_later' | 'got_it') => {
    markNudgeShown()
    try {
      posthog.capture('pwa_install_nudge_dismissed', { button, trigger })
    } catch {}
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={() => dismiss('maybe_later')}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Icon */}
        <div style={{
          width: 44, height: 44, margin: '0 auto 12px',
          background: 'rgba(126,211,33,0.15)',
          border: `1.5px solid ${GREEN}`,
          clipPath: CHUNKY.badge,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14"/>
            <path d="M5 12l7-7 7 7"/>
          </svg>
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.5, marginBottom: 14 }}>
          {t('body')}
        </p>

        {/* Animated mini iPhone */}
        <div style={{
          width: 220, height: 260,
          margin: '0 auto 14px',
          background: '#0d0d0d',
          border: '6px solid #2a2a2a',
          borderRadius: 24,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(180deg, #1a1a1a, #0a0a0a)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Fake page */}
            <div style={{ padding: 8, color: '#555', fontSize: 7 }}>
              <div style={{
                background: GREEN, color: '#000',
                fontSize: 8, padding: 3, textAlign: 'center', fontWeight: 900,
              }}>
                PADELNACHOS
              </div>
              <div style={{ padding: '10px 0', color: '#aaa' }}>Live scores</div>
              <div style={{ background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 4, marginBottom: 4 }}>
                Galán · LIVE
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 4 }}>
                Tapia · 6-3
              </div>
            </div>

            {/* Fake Safari toolbar */}
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 28,
              background: 'rgba(40,40,40,0.95)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around',
            }}>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
              {/* Share button — the highlight target */}
              <div style={{ width: 18, height: 18, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v14"/>
                  <path d="M5 9l7-7 7 7"/>
                  <rect x="3" y="14" width="18" height="8" rx="2"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </div>
            </div>

            {/* Animated finger pointing to Share */}
            <div className="pn-pwa-finger" />

            {/* Animated Share sheet */}
            <div className="pn-pwa-sheet">
              <div className="pn-pwa-sheet-row">📋 {t('shareLabel')}</div>
              <div className="pn-pwa-sheet-row pn-pwa-sheet-highlight">
                📲 {t('addLabel')}
              </div>
              <div className="pn-pwa-sheet-row">📰 {t('openLabel')}</div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => dismiss('maybe_later')}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('maybeLater')}
          </button>
          <PressButton
            type="button"
            onClick={() => dismiss('got_it')}
            {...PRESS_PRESETS.chunkyTilted}
            style={{
              flex: 1,
              height: 40,
              fontSize: 12,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {t('gotIt')}
          </PressButton>
        </div>
      </div>

      {/* Animation styles. Uses a class so style={...} doesn't have to
          carry keyframes (React inline styles can't define them). */}
      <style dangerouslySetInnerHTML={{ __html: `
        .pn-pwa-finger {
          position: absolute;
          bottom: 24px;
          width: 18px; height: 18px;
          left: 130px;
          border-radius: 50%;
          background: rgba(126,211,33,0.4);
          border: 2px solid #7ED321;
          animation: pn-pwa-finger-tap 3s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pn-pwa-finger-tap {
          0%, 25% { transform: scale(1); opacity: 1; }
          35% { transform: scale(0.7); opacity: 0.7; }
          45%, 100% { transform: scale(1); opacity: 0; }
        }

        .pn-pwa-sheet {
          position: absolute;
          bottom: -200px;
          left: 8px; right: 8px;
          background: linear-gradient(180deg, #2a2a2a, #1c1c1c);
          border-radius: 8px 8px 0 0;
          padding: 8px;
          animation: pn-pwa-sheet-up 3s ease-in-out infinite;
        }
        @keyframes pn-pwa-sheet-up {
          0%, 30% { bottom: -200px; }
          50%, 80% { bottom: 28px; }
          90%, 100% { bottom: -200px; }
        }

        .pn-pwa-sheet-row {
          padding: 4px 6px;
          font-size: 7px;
          color: #aaa;
          display: flex;
          align-items: center;
          gap: 4px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .pn-pwa-sheet-highlight {
          color: #7ED321;
          background: rgba(126,211,33,0.1);
          animation: pn-pwa-sheet-pulse 3s ease-in-out infinite;
        }
        @keyframes pn-pwa-sheet-pulse {
          0%, 60% { background: rgba(126,211,33,0); }
          70%, 80% { background: rgba(126,211,33,0.2); }
          100% { background: rgba(126,211,33,0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .pn-pwa-finger,
          .pn-pwa-sheet,
          .pn-pwa-sheet-highlight {
            animation: none !important;
          }
          .pn-pwa-sheet { bottom: 28px !important; }
          .pn-pwa-sheet-highlight { background: rgba(126,211,33,0.2) !important; }
        }
      `}} />
    </div>
  )
}
