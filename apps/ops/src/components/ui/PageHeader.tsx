import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ui-ph">
      <div>
        <h1 className="ui-ph-title">{title}</h1>
        {subtitle != null && <p className="ui-ph-sub">{subtitle}</p>}
      </div>
      {actions != null && <div className="ui-ph-actions">{actions}</div>}
    </div>
  )
}
