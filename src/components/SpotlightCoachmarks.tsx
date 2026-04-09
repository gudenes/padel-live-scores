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
}

const STEPS: Step[] = [
  {
    title: '🔍 Find anything',
    description: 'Find your favorite players, upcoming tournaments and live matches. All Premier Padel and FIP Tour events in one place!',
    targetSelector: '[data-coachmark="search"]',
  },
  {
    title: '☆ Your following feed',
    description: 'Follow the players and tournaments you love. Everything you care about, all in one place!',
    targetSelector: '[data-coachmark="following"]',
  },
  {
    title: '🏆 Earn badges',
    description: 'Unlock badges as you explore! From Rookie to Padel Genius, collect them all and show off your padel passion.',
    targetSelector: '[data-coachmark="profile"]',
    ctaLabel: 'Vamos! 🎾',
  },
]

export function SpotlightCoachmarks() {
  const [currentStep, setCurrentStep] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [isCircular, setIsCircular] = useState(false)
  const rafRef = useRef<number | null>(null)

  // Check if onboarding has been completed
  useEffect(() => {
    if (typeof window === 'undefined') return
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) {
      // Delay slightly so the page renders first
      const timer = setTimeout(() => setCurrentStep(0), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  // Position the spotlight on the target element
  const updateTargetRect = useCallback(() => {
    if (currentStep === null || currentStep >= STEPS.length) return
    const step = STEPS[currentStep]
    const el = document.querySelector(step.targetSelector)
    if (el) {
      const rect = el.getBoundingClientRect()
      setTargetRect(rect)
      // Detect if the element is roughly circular (e.g. profile button)
      const ratio = rect.width / rect.height
      setIsCircular(ratio > 0.8 && ratio < 1.2 && rect.width < 50)
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
          // Use a CSS mask to cut out the spotlight area
          background: 'rgba(0,0,0,0.82)',
          ...(targetRect ? {
            maskImage: `radial-gradient(
              ${isCircular ? 'circle' : 'ellipse'}
              ${(targetRect.width / 2) + padding}px ${(targetRect.height / 2) + padding}px
              at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
              transparent 100%, black 100%
            )`,
            WebkitMaskImage: `radial-gradient(
              ${isCircular ? 'circle' : 'ellipse'}
              ${(targetRect.width / 2) + padding}px ${(targetRect.height / 2) + padding}px
              at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
              transparent 100%, black 100%
            )`,
          } : {}),
        }}
      />

      {/* Spotlight ring — green glowing border around the target */}
      {targetRect && (
        <div style={{
          position: 'fixed',
          zIndex: 10001,
          top: targetRect.top - padding,
          left: targetRect.left - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          border: `2px solid ${GREEN}`,
          borderRadius: isCircular ? '50%' : 8,
          boxShadow: `0 0 20px rgba(126,211,33,0.5), inset 0 0 20px rgba(126,211,33,0.15)`,
          pointerEvents: 'none',
          animation: 'coachmark-ring-pulse 2s ease-in-out infinite',
        }} />
      )}

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

        {/* Title */}
        <div style={{
          fontSize: 15, fontWeight: 900, color: '#fff',
          marginBottom: 6, lineHeight: 1.2,
        }}>
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
