'use client'
// src/components/Avatar.tsx
// Reusable avatar component using next/image for automatic optimization
// (WebP conversion, srcSet generation, lazy loading).

import { useState } from 'react'
import Image from 'next/image'

interface AvatarProps {
  src: string | null | undefined
  alt: string
  size: number
  /** Optional fallback initial letter */
  fallback?: string
  style?: React.CSSProperties
  className?: string
  /** Skip next/image optimization for external URLs not in remotePatterns */
  unoptimized?: boolean
}

export default function Avatar({ src, alt, size, fallback, style, className, unoptimized }: AvatarProps) {
  // A broken/expired image URL falls back to initials instead of a broken-image icon.
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    // Fallback: colored circle with initials. `fallback` may carry up to 2
    // characters (e.g. "GP"); without it, the first letter of `alt`.
    const initial = (fallback ? fallback.slice(0, 2) : (alt ?? '?')[0] ?? '?').toUpperCase()
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.4,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.4)',
          flexShrink: 0,
          ...style,
        }}
      >
        {initial}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      unoptimized={unoptimized}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        ...style,
      }}
    />
  )
}
