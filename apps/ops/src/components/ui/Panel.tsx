import type { ReactNode } from 'react'

export function Panel({
  title,
  actions,
  padded = true,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  padded?: boolean
  children: ReactNode
}) {
  return (
    <div className="ui-panel">
      {(title != null || actions != null) && (
        <div className="ui-panel-head">
          {title != null ? <h3 className="ui-panel-title">{title}</h3> : <span />}
          {actions != null && <div className="ui-ph-actions">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'ui-panel-pad' : undefined}>{children}</div>
    </div>
  )
}

export function Section({
  label,
  actions,
  children,
}: {
  label: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="ui-section">
      <div className="ui-section-head">
        <h2 className="ui-section-label">{label}</h2>
        {actions != null && <div className="ui-ph-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
