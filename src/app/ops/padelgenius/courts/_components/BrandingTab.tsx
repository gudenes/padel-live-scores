'use client'
import type { CourtConfig, BrandingSlots, SlotConfig } from '@/lib/padelgenius/types'
import { SlotCard } from './SlotCard'

const SLOT_META: { slot: keyof BrandingSlots; label: string; dimsHint: string }[] = [
  { slot: 'backWall',       label: 'BACK WALL',       dimsHint: '1200 x 280 px' },
  { slot: 'sideGlassLeft',  label: 'SIDE GLASS · L',  dimsHint: '400 x 140 px' },
  { slot: 'sideGlassRight', label: 'SIDE GLASS · R',  dimsHint: '400 x 140 px' },
  { slot: 'netBand',        label: 'NET BAND',        dimsHint: '1000 x 80 px' },
  { slot: 'floorCenter',    label: 'FLOOR CENTER',    dimsHint: '400 x 400 px' },
]

export function BrandingTab({ slug, config, onChange }: { slug: string; config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setSlot = (slot: keyof BrandingSlots, value: SlotConfig | null) =>
    onChange({ ...config, branding: { ...config.branding, [slot]: value } })

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          {/* Render the same overlays the Scene uses */}
          {config.branding.backWall && <img alt="" src={config.branding.backWall.logoUrl} style={{ position: 'absolute', top: '13%', left: '18%', width: '64%', height: '7%', objectFit: 'contain' }} />}
          {config.branding.sideGlassLeft && <img alt="" src={config.branding.sideGlassLeft.logoUrl} style={{ position: 'absolute', top: '45%', left: '2%', width: '16%', height: '6%', objectFit: 'contain' }} />}
          {config.branding.sideGlassRight && <img alt="" src={config.branding.sideGlassRight.logoUrl} style={{ position: 'absolute', top: '45%', right: '2%', width: '16%', height: '6%', objectFit: 'contain' }} />}
          {config.branding.netBand && <img alt="" src={config.branding.netBand.logoUrl} style={{ position: 'absolute', top: '50%', left: '10%', width: '80%', height: '2%', objectFit: 'contain' }} />}
          {config.branding.floorCenter && <img alt="" src={config.branding.floorCenter.logoUrl} style={{ position: 'absolute', top: '65%', left: '40%', width: '20%', height: '15%', objectFit: 'contain' }} />}
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {SLOT_META.map(m => <SlotCard key={m.slot} slug={slug} slot={m.slot} label={m.label} dimsHint={m.dimsHint} value={config.branding[m.slot]} onChange={v => setSlot(m.slot, v)} />)}
      </div>
    </div>
  )
}
