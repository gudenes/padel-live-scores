'use client'

import { useState } from 'react'

export default function CoachAvatar({ src, name }: { src?: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const style = { width: 36, height: 36, borderRadius: '50%', flexShrink: 0 } as const
  if (src && failedSrc !== src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={36} height={36} loading="lazy"
      onError={() => setFailedSrc(src)} style={{ ...style, objectFit: 'cover' }} />
  }
  return <span aria-hidden="true" style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)', color: 'var(--text-3)', fontSize: 12 }}>
    {name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
  </span>
}
