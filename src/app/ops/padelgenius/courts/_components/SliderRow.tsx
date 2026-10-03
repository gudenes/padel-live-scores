'use client'
export function SliderRow({
  label, value, min, max, step, color, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; color: string;
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 10, color: '#aaa' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#fff', fontFamily: 'ui-monospace,monospace' }}>{value.toFixed(3)}</span>
      </div>
      <input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(parseFloat(e.target.value))}
             style={{ width: '100%', accentColor: color }} />
    </div>
  )
}
