'use client'
// src/components/SpotlightCoachmarks.tsx
//
// 3-step spotlight onboarding shown on first visit. Each step highlights
// a key UI element with a dark overlay + green spotlight ring + tip card.
// Only shows once per device (tracked via localStorage).
// Steps:
//   1. Search bar — "Find your favorite players..."
//   2. Following tab — "Follow the players you love..."
//   3. Profile button — "Unlock badges as you explore..."

import { useState, useEffect, useCallback, useRef } from 'react'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 2%, 100% 0%, 99.5% 98%, 0.5% 100%)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'
const CHUNKY_DOT = 'polygon(2% 0%, 98% 0%, 100% 100%, 0% 100%)'

const STORAGE_KEY = 'pn_onboarding_done'

interface Step {
  title: string
  description: string
  /** CSS selector for the element to spotlight */
  targetSelector: string
  /** CTA button label (last step only) */
  ctaLabel?: string
  /** Icon type for the branded SVG icon */
  iconType: 'search' | 'following' | 'badges'
}

// Branded SVG icons in chunky badge shape — matches the app's visual language
const CHUNKY_ICON = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

function StepIcon({ type }: { type: 'search' | 'following' | 'badges' }) {
  const icons = {
    search: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
    ),
    following: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    badges: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
      </svg>
    ),
  }
  return (
    <div style={{
      width: 28, height: 28,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      clipPath: CHUNKY_ICON,
      background: `linear-gradient(135deg, ${GREEN}40, ${GREEN}10)`,
      border: `1.5px solid ${GREEN}`,
      marginRight: 8,
      verticalAlign: 'middle',
      flexShrink: 0,
    }}>
      {icons[type]}
    </div>
  )
}

const STEPS: Step[] = [
  {
    title: 'Find anything',
    description: 'Find your favorite players, upcoming tournaments and matches.',
    targetSelector: '[data-coachmark="search"]',
    iconType: 'search',
  },
  {
    title: 'Your following feed',
    description: 'Follow the players and tournaments you love. Everything you care about, all in one place!',
    targetSelector: '[data-coachmark="following"]',
    iconType: 'following',
  },
  {
    title: 'Earn badges',
    description: 'Unlock badges as you explore! From Rookie to Padel Genius, collect them all and show off your padel passion.',
    targetSelector: '[data-coachmark="profile"]',
    ctaLabel: '¡Vamos!',
    iconType: 'badges',
  },
]

export function SpotlightCoachmarks() {
  const [currentStep, setCurrentStep] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)

  // Check if onboarding has been completed.
  // If a referral welcome banner is showing (?ref= in URL), wait
  // until the user dismisses it before starting the tutorial.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const done = localStorage.getItem(STORAGE_KEY)
    if (done) return

    // Check if a referral welcome banner is active
    const refCode = new URLSearchParams(window.location.search).get('ref')
    const bannerActive = refCode && !sessionStorage.getItem(`pn_welcome_dismissed_${refCode}`)

    if (!bannerActive) {
      // No banner — start tutorial after a short delay
      const timer = setTimeout(() => setCurrentStep(0), 800)
      return () => clearTimeout(timer)
    }

    // Banner is showing — poll sessionStorage until it's dismissed
    const poll = setInterval(() => {
      if (sessionStorage.getItem(`pn_welcome_dismissed_${refCode}`)) {
        clearInterval(poll)
        // Short delay after banner dismissal before starting tutorial
        setTimeout(() => setCurrentStep(0), 600)
      }
    }, 300)
    return () => clearInterval(poll)
  }, [])

  // Position the spotlight on the target element
  const updateTargetRect = useCallback(() => {
    if (currentStep === null || currentStep >= STEPS.length) return
    const step = STEPS[currentStep]
    const el = document.querySelector(step.targetSelector)
    if (el) {
      const rect = el.getBoundingClientRect()
      setTargetRect(rect)
    }
  }, [currentStep])

  // Elevate the target element above the overlay so it's visible
  // in the spotlight cutout. Also elevate its sticky/fixed ancestors
  // (e.g. the header for the profile button, the nav for following tab).
  useEffect(() => {
    if (currentStep === null || currentStep >= STEPS.length) return
    const step = STEPS[currentStep]
    const el = document.querySelector(step.targetSelector) as HTMLElement | null
    if (!el) return

    // Collect elements to elevate: the target + any fixed/sticky ancestors
    const toElevate: HTMLElement[] = [el]
    let parent = el.parentElement
    while (parent) {
      const pos = window.getComputedStyle(parent).position
      if (pos === 'fixed' || pos === 'sticky') {
        toElevate.push(parent)
      }
      parent = parent.parentElement
    }

    // Save original z-index values and set high z-index
    const originals = toElevate.map(e => ({ el: e, zIndex: e.style.zIndex }))
    toElevate.forEach(e => { e.style.zIndex = '10001' })

    return () => {
      originals.forEach(({ el: e, zIndex }) => { e.style.zIndex = zIndex })
    }
  }, [currentStep])

  useEffect(() => {
    updateTargetRect()
    // Re-measure on scroll/resize
    const handleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateTargetRect)
    }
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, { passive: true })
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updateTargetRect])

  const handleNext = useCallback(() => {
    if (currentStep === null) return
    if (currentStep >= STEPS.length - 1) {
      // Last step — finish onboarding
      setCurrentStep(null)
      try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    } else {
      setCurrentStep(currentStep + 1)
    }
  }, [currentStep])

  const handleSkip = useCallback(() => {
    setCurrentStep(null)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
  }, [])

  // Don't render if onboarding is done or no step is active
  if (currentStep === null || currentStep >= STEPS.length) return null

  const step = STEPS[currentStep]
  const isLastStep = currentStep === STEPS.length - 1
  const padding = 6 // px around the target element

  // Compute tip card position — above or below the target
  const tipAbove = targetRect && targetRect.top > 300
  const tipStyle: React.CSSProperties = targetRect ? {
    position: 'fixed',
    zIndex: 10002,
    width: 280,
    maxWidth: 'calc(100vw - 40px)',
    left: '50%',
    transform: 'translateX(-50%)',
    ...(tipAbove
      ? { bottom: window.innerHeight - targetRect.top + padding + 12 }
      : { top: targetRect.bottom + padding + 12 }
    ),
  } : {
    position: 'fixed',
    zIndex: 10002,
    width: 280,
    maxWidth: 'calc(100vw - 40px)',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }

  return (
    <>
      {/* Dark overlay — click anywhere to advance (same as Next) */}
      <div
        onClick={handleNext}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          // Use an SVG mask to cut out a rectangular spotlight area
          background: 'rgba(0,0,0,0.82)',
          ...(targetRect ? (() => {
            // Build an SVG mask with a rectangular hole where the target is
            const x = Math.max(0, targetRect.left - padding)
            const y = Math.max(0, targetRect.top - padding)
            const w = targetRect.width + padding * 2
            const h = Math.min(targetRect.height + padding * 2, window.innerHeight - y)
            const svg = `url("data:image/svg+xml,${encodeURIComponent(
              `<svg xmlns='http://www.w3.org/2000/svg' width='${window.innerWidth}' height='${window.innerHeight}'>` +
              `<defs><mask id='m'>` +
              `<rect width='100%' height='100%' fill='white'/>` +
              `<rect x='${x}' y='${y}' width='${w}' height='${h}' fill='black' rx='4'/>` +
              `</mask></defs>` +
              `<rect width='100%' height='100%' fill='white' mask='url(%23m)'/>` +
              `</svg>`)
            }")`
            return {
              maskImage: svg,
              WebkitMaskImage: svg,
            }
          })() : {}),
        }}
      />

      {/* Spotlight ring — green glowing border with chunky clip-path */}
      {targetRect && (() => {
        // Clamp the ring so it doesn't overflow the viewport
        const ringTop = Math.max(0, targetRect.top - padding)
        const ringLeft = Math.max(0, targetRect.left - padding)
        const ringWidth = targetRect.width + padding * 2
        const ringHeight = Math.min(
          targetRect.height + padding * 2,
          window.innerHeight - ringTop
        )
        return (
          <div style={{
            position: 'fixed',
            zIndex: 10001,
            top: ringTop,
            left: ringLeft,
            width: ringWidth,
            height: ringHeight,
            border: `2px solid ${GREEN}`,
            clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
            boxShadow: `0 0 20px rgba(126,211,33,0.5)`,
            pointerEvents: 'none',
            animation: 'coachmark-ring-pulse 2s ease-in-out infinite',
          }} />
        )
      })()}

      {/* Tip card */}
      <div
        style={{
          ...tipStyle,
          background: '#1E1E1E',
          clipPath: CHUNKY_CARD,
          padding: '16px 18px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
          animation: 'coachmark-tip-appear 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onClick={(e) => e.stopPropagation()} // Don't dismiss when clicking the card
      >
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: 20, height: 4,
                clipPath: CHUNKY_DOT,
                background: i <= currentStep ? GREEN : 'rgba(255,255,255,0.1)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>

        {/* Title with branded icon */}
        <div style={{
          fontSize: 15, fontWeight: 900, color: '#fff',
          marginBottom: 6, lineHeight: 1.2,
          display: 'flex', alignItems: 'center',
        }}>
          <StepIcon type={step.iconType} />
          {step.title}
        </div>

        {/* Description */}
        <div style={{
          fontSize: 12, color: '#aaa', lineHeight: 1.5,
          marginBottom: 14,
        }}>
          {step.description}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {!isLastStep ? (
            <button
              onClick={handleSkip}
              style={{
                fontSize: 11, color: '#555', cursor: 'pointer',
                background: 'none', border: 'none', fontFamily: 'inherit',
              }}
            >
              Skip
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={handleNext}
            style={{
              padding: '8px 20px',
              background: GREEN,
              color: '#000',
              fontSize: 12, fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              clipPath: CHUNKY_BUTTON,
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isLastStep ? (step.ctaLabel ?? 'Done') : 'Next →'}
          </button>
        </div>
      </div>

      {/* Animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes coachmark-tip-appear {
          0% { opacity: 0; transform: translateX(-50%) translateY(8px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes coachmark-ring-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(126,211,33,0.5), inset 0 0 20px rgba(126,211,33,0.15); }
          50% { box-shadow: 0 0 30px rgba(126,211,33,0.7), inset 0 0 30px rgba(126,211,33,0.25); }
        }
      `}} />
    </>
  )
}
