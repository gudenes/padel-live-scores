import Image from 'next/image'
import type { TierNumber } from '@/lib/badges'

export const COLLECTION_ICONS = ['first-pick', 'king-of-predict', 'on-fire', 'tournament-brain', 'scout', 'match-tracker', 'match-critic', 'founding-member', 'ambassador']

// Measured bounds preserve the full die-cut edge of each generated sticker.
export const STICKER_ICONS: Record<string, string> = {
  checkmark: '12 28 316 286', crown: '326 40 298 274',
  lightbulb: '634 10 312 316', bell: '940 26 305 295',
  search: '20 324 305 281', globe: '328 324 289 280',
  bookmark: '653 326 265 280', star: '936 315 305 288',
  document: '20 620 305 270', play: '329 632 292 240',
  share: '624 619 337 288', flame: '972 610 254 292',
  diamond: '23 920 300 270', bolt: '341 902 244 299',
  trophy: '628 916 302 290', rackets: '955 913 275 285',
}

export function BadgeSticker({icon, tier, size}: {icon: string; tier: TierNumber | null; size: number}) {
  return <span aria-hidden="true" style={{display:'inline-block',position:'relative',width:size,height:size,flexShrink:0}}>
    {COLLECTION_ICONS.includes(icon) ? <Image src={`/play/badges/collection-v2/${icon}.webp`} alt="" width={size} height={size} sizes={`${size}px`} style={{display:'block',mixBlendMode:'lighten',filter:tier===null?'saturate(.4) brightness(.9)':undefined}} /> : <svg viewBox={STICKER_ICONS[icon]} width={size} height={size} style={{display:'block',mixBlendMode:'lighten',filter:tier===null?'saturate(.25) brightness(.8)':undefined}}>
      <image href="/play/badges/collectible-stickers-orange-v2.webp" width="1254" height="1254"/>
    </svg>}
    {tier === null && COLLECTION_ICONS.includes(icon) && (
      <span style={{
        position: 'absolute', right: 0, bottom: 0,
        width: Math.max(20, Math.round(size * .3)),
        height: Math.max(20, Math.round(size * .3)),
        display: 'grid', placeItems: 'center',
        background: '#29291f', color: '#ffa050',
        border: '1px solid #b7743e', borderBottom: '3px solid #75421f',
        borderRadius: 4, boxShadow: '0 2px 6px #0008',
        transform: 'rotate(-4deg)', pointerEvents: 'none',
      }}>
        <svg width="64%" height="64%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </svg>
      </span>
    )}
    {tier !== null && size >= 48 && !COLLECTION_ICONS.includes(icon) && <span style={{position:'absolute',right:0,bottom:0,padding:'2px 5px',background:'#242520',border:'1px solid #ff8a3d',color:'#eee7d2',fontSize:10,fontWeight:800,lineHeight:1.2}}>{['','I','II','III','IV'][tier]}</span>}
  </span>
}
