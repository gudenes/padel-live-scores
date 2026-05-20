// apps/ops/src/components/PlanStub.tsx
// Placeholder used by every (app)/<route>/page.tsx that Plan 3 will fill in.
// Same visual shell so navigation always feels alive even before the real
// tab lands.

export function PlanStub({ title, plan = 'Plan 3' }: { title: string; plan?: string }) {
  return (
    <div
      style={{
        padding: 32,
        maxWidth: 720,
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{title}</h1>
      <p style={{ fontSize: 14, color: 'var(--status-neutral)', margin: 0 }}>
        Coming in <strong>{plan}</strong>.
      </p>
    </div>
  )
}
