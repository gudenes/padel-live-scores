'use client'

import { ReactNode, CSSProperties } from 'react'

type Variant = 'default' | 'green' | 'orange'

export interface ChunkyPressButtonProps {
  onClick?: () => void
  variant?: Variant
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  children: ReactNode
}

const VARIANT_COLOR: Record<Variant, string> = {
  default: 'rgba(255,255,255,0.94)',
  green:   '#7ED321',
  orange:  '#F5A623',
}

export function ChunkyPressButton({
  onClick, variant = 'default', className, style, ariaLabel, children,
}: ChunkyPressButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={className}
      style={{
        display: 'inline-block',
        padding: 0,
        border: 0,
        background: 'transparent',
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
        transition: 'filter 100ms, transform 100ms ease-out',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
      onPointerDown={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(1px)'
        el.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'
      }}
      onPointerUp={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
      }}
      onPointerLeave={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
      }}
    >
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1C2029',
        clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
        color: VARIANT_COLOR[variant],
      }}>
        {children}
      </span>
    </button>
  )
}
