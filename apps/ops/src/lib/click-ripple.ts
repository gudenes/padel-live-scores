// apps/ops/src/lib/click-ripple.ts
// Spawns a lime ink-wash ripple from the click point inside `host`.
// The host gets `position: relative` + `overflow: hidden` (if not already set)
// so the ripple stays bounded. The ripple element is auto-removed after 600ms.

import type { MouseEvent } from 'react'

export function spawnRipple(host: HTMLElement, event: MouseEvent): void {
  const rect = host.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const size = Math.max(rect.width, rect.height)

  const ripple = document.createElement('span')
  ripple.className = 'ops-ripple'
  ripple.style.left = `${x - size / 2}px`
  ripple.style.top = `${y - size / 2}px`
  ripple.style.width = `${size}px`
  ripple.style.height = `${size}px`

  // Ensure the host can host an absolutely-positioned child
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
  host.style.overflow = 'hidden'

  host.appendChild(ripple)
  setTimeout(() => ripple.remove(), 600)
}
