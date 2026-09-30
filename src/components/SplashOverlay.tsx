'use client'

import { useEffect, useState } from 'react'

// Client components also render on the server, so the logo is present in
// the first frame. Dismiss after hydration rather than waiting for every
// image and external script to finish loading. React also runs this effect
// when an error boundary mounts the layout on the client, where a raw
// inline <script> would never execute.
export default function SplashOverlay() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setHidden(true), 150)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div id="splash-overlay" className={hidden ? 'hidden' : undefined} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="splash-overlay-logo"
        src="/splash-logo.png"
        alt=""
        fetchPriority="high"
      />
    </div>
  )
}
