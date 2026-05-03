'use client'
// src/components/BootAnimation.tsx
// Animated boot overlay that takes over right after the native static
// splash hides. Native splash establishes brand presence from the
// first frame; this overlay then plays the motion brand moment before
// revealing the app. Web users never see this — gated on Capacitor.
//
// Timing budget (post-WebView-paint):
//   0ms     overlay mounts, paddle starts scaling up
//   200ms   wordmark slides up
//   600ms   slogan fades in
//   1100ms  hold (let the user read it)
//   1300ms  overlay starts fading out
//   1700ms  overlay unmounts, app interactive
//
// Tweak the constants below to dial in. CSS is inlined as a `<style>`
// block so this file is self-contained — no globals.css edits.

import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

const HOLD_MS = 1300        // when the fade-out kicks in
const FADE_MS = 400         // how long the fade-out takes

export function BootAnimation() {
  // Detect native at mount time, not at module load — Capacitor.isNativePlatform()
  // is safe at module load too, but using state keeps this SSR-safe.
  const [show, setShow] = useState(false)
  const [phase, setPhase] = useState<'in' | 'out'>('in')

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    setShow(true)
    const t1 = setTimeout(() => setPhase('out'), HOLD_MS)
    const t2 = setTimeout(() => setShow(false), HOLD_MS + FADE_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (!show) return null

  return (
    <>
      <div className="boot-overlay" data-phase={phase} aria-hidden>
        <div className="boot-stack">
          <img
            src="/icon-512.png"
            alt=""
            className="boot-paddle"
            draggable={false}
          />
          <div className="boot-wordmark">PADEL NACHOS</div>
          <div className="boot-slogan">Live padel, every point.</div>
        </div>
      </div>
      <style>{BOOT_CSS}</style>
    </>
  )
}

// Keyframes + class definitions kept inline so the overlay is fully
// self-contained. Class prefix `boot-` avoids collisions with app CSS.
const BOOT_CSS = `
.boot-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: #000;
  display: grid;
  place-items: center;
  transition: opacity ${FADE_MS}ms ease-out;
  pointer-events: none;
}
.boot-overlay[data-phase="out"] { opacity: 0; }

.boot-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  text-align: center;
}

.boot-paddle {
  width: 200px;
  height: 200px;
  user-select: none;
  -webkit-user-drag: none;
  animation: bootPaddleIn 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.boot-wordmark {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-weight: 800;
  font-size: 28px;
  letter-spacing: 0.04em;
  color: #fff;
  margin-top: 8px;
  animation: bootWordmarkIn 500ms cubic-bezier(0.25, 0.1, 0.25, 1) 200ms both;
}

.boot-slogan {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.6);
  animation: bootSloganIn 600ms cubic-bezier(0.25, 0.1, 0.25, 1) 600ms both;
}

@keyframes bootPaddleIn {
  0%   { opacity: 0; transform: scale(0.5) rotate(-8deg); }
  60%  { opacity: 1; }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}
@keyframes bootWordmarkIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes bootSloganIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 0.6; transform: translateY(0); }
}

/* Respect users who disable motion — show the final state instantly. */
@media (prefers-reduced-motion: reduce) {
  .boot-paddle,
  .boot-wordmark,
  .boot-slogan { animation: none; }
}
`
