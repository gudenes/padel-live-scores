// src/lib/confetti.ts
//
// Shared confetti burst animation. Spawns chunky pieces from a
// DOM element's center. Used by match rating and badge toasts.

const DEFAULT_COLORS = ['#7ED321', '#F5A623', '#7ED321', '#fff', '#F5A623', '#7ED321', '#F5A623', '#fff']
const DEFAULT_COUNT = 38

export function spawnConfetti(originEl: HTMLElement, options?: {
  count?: number
  colors?: string[]
}): void {
  const count = options?.count ?? DEFAULT_COUNT
  const colors = options?.colors ?? DEFAULT_COLORS

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    pointerEvents: 'none', zIndex: '9999', overflow: 'hidden',
  })
  document.body.appendChild(overlay)

  const rect = originEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div')
    const w = 6 + Math.random() * 8
    const h = 4 + Math.random() * 6
    Object.assign(piece.style, {
      position: 'absolute', pointerEvents: 'none', willChange: 'transform, opacity',
      width: `${w}px`, height: `${h}px`,
      background: colors[i % colors.length],
      clipPath: 'polygon(4% 6%, 96% 0%, 100% 94%, 0% 100%)',
      left: `${cx}px`, top: `${cy}px`, opacity: '1',
    })
    overlay.appendChild(piece)

    const angle = Math.random() * Math.PI * 2
    const speed = 200 + Math.random() * 400
    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed - (200 + Math.random() * 300)
    const rotSpeed = -720 + Math.random() * 1440
    const wobbleAmp = 20 + Math.random() * 40
    const wobbleFreq = 2 + Math.random() * 3
    const gravity = 800
    const duration = 2.2
    let start: number | null = null

    function animate(ts: number) {
      if (!start) start = ts
      const elapsed = (ts - start) / 1000
      const progress = elapsed / duration
      if (progress >= 1) { piece.remove(); return }
      const x = vx * elapsed + Math.sin(elapsed * wobbleFreq) * wobbleAmp * elapsed * 0.3
      const y = vy * elapsed + 0.5 * gravity * elapsed * elapsed
      const rot = rotSpeed * elapsed
      const opacity = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1
      piece.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`
      piece.style.opacity = `${opacity}`
      requestAnimationFrame(animate)
    }
    setTimeout(() => requestAnimationFrame(animate), Math.random() * 80)
  }

  setTimeout(() => overlay.remove(), 2800)
}
