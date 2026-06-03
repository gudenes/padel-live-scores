import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'lime' | 'live' | 'warn' | 'urgent' | 'men' | 'women' | 'neutral'

export function Pill({
  tone = 'neutral',
  dot = false,
  pulse = false,
  children,
}: {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  children: ReactNode
}) {
  return (
    <span className="ui-pill" data-tone={tone}>
      {dot && <span className={pulse ? 'ui-pill-dot live-pulse' : 'ui-pill-dot'} />}
      {children}
    </span>
  )
}

export function Button({
  variant = 'default',
  size = 'md',
  children,
  ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="ui-btn"
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'md' ? undefined : size}
      {...rest}
    >
      {children}
    </button>
  )
}
