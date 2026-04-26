// src/components/SkeletonText.tsx
// Inline shimmer placeholder for data still in flight.
// CSS lives in globals.css under `.skeleton-line` (animation +
// reduced-motion fallback). Use anywhere a known-width text value
// is loading so the surrounding layout doesn't jump on hydration.

interface SkeletonTextProps {
  /** Pixel width or any valid CSS length */
  width: number | string
  /** Defaults to 0.9em (matches surrounding text baseline) */
  height?: number | string
  className?: string
}

export function SkeletonText({ width, height = '0.9em', className }: SkeletonTextProps) {
  return (
    <span
      className={`skeleton-line${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    >
      &nbsp;
    </span>
  )
}

/** Block-level shimmer (e.g., avatar, card thumbnails) */
export function SkeletonBlock({
  width, height, radius = 4, className,
}: {
  width: number | string
  height: number | string
  radius?: number | string
  className?: string
}) {
  return (
    <div
      className={`skeleton-line${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius, display: 'block' }}
      aria-hidden="true"
    />
  )
}
