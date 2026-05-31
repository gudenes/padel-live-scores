import type { ReactNode } from 'react'

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">{children}</table>
    </div>
  )
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="ui-field">
      {label != null && <span className="ui-field-label">{label}</span>}
      {children}
    </label>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-title">{title}</div>
      {hint != null && <div className="ui-empty-hint">{hint}</div>}
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ui-skel" style={{ width: `${100 - i * 8}%` }} />
      ))}
    </div>
  )
}
