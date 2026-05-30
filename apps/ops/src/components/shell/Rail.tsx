'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { Icon } from '../../app/(app)/live-odds/_components/icons'

type Item = { href: string; label: string; icon: string; pill?: 'live'; cnt?: number }
type Group = { label?: string; items: Item[] }

const GROUPS: Group[] = [
  { items: [
    { href: '/live-odds', label: 'Live Odds', icon: 'odds', pill: 'live' },
    { href: '/today', label: 'Today', icon: 'today' },
  ]},
  { label: 'Tournament Ops', items: [
    { href: '/tournament-explorer', label: 'Tournament Explorer', icon: 'grid' },
    { href: '/entry-lists', label: 'Entry Lists', icon: 'list' },
    { href: '/needs-review', label: 'Needs Review', icon: 'flag', cnt: 3 },
    { href: '/simulator', label: 'Simulator', icon: 'play' },
  ]},
  { label: 'Catalogs', items: [
    { href: '/players', label: 'Players', icon: 'users' },
    { href: '/brands', label: 'Brands & Equipment', icon: 'tag' },
    { href: '/streams', label: 'Streams', icon: 'video' },
    { href: '/yt-channels', label: 'YT Channels', icon: 'yt' },
  ]},
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
  ]},
  { label: 'System', items: [
    { href: '/system/integration-health', label: 'Integration Health', icon: 'heart' },
    { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
    { href: '/system/padelgod-health', label: 'Padelgod Health', icon: 'server' },
    { href: '/system/shadow-mode', label: 'Shadow Mode', icon: 'eye' },
    { href: '/system/coverage-matrix', label: 'Coverage Matrix', icon: 'matrix' },
    { href: '/system/feature-flags', label: 'Feature Flags', icon: 'toggle' },
    { href: '/system/architecture', label: 'Architecture', icon: 'arch' },
  ]},
]

export function Rail({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname()
  const [closed, setClosed] = useState<Set<string>>(new Set(['System']))
  const toggleGroup = (g: string) => setClosed(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  return (
    <nav className="rail">
      <div className="railtop">
        <span className="rt-lbl">Console</span>
        <button className="collapse" onClick={onToggle} aria-label="Collapse sidebar"><Icon id="chev" /></button>
      </div>
      <div className="railscroll">
        {GROUPS.map((g, gi) => (
          <div key={gi} className={`navgroup ${g.label && closed.has(g.label) ? 'closed' : ''}`}>
            {g.label && (
              <div className="gl" onClick={() => !collapsed && toggleGroup(g.label!)}>
                <span className="glabel">{g.label}</span>
                <span className="gcount">{g.items.length}</span>
                <span className="chev">▾</span>
              </div>
            )}
            <div className="items">
              {g.items.map(it => {
                const active = pathname === it.href || pathname.startsWith(it.href + '/')
                return (
                  <Link key={it.href} href={it.href} className={`nav ${active ? 'active' : ''}`} data-tip={it.label}>
                    <Icon id={it.icon} />
                    <span className="lbl">{it.label}</span>
                    {it.pill === 'live' && <span className="pill"><span className="d" />LIVE</span>}
                    {it.cnt != null && <span className="cnt">{it.cnt}</span>}
                    {(it.pill || it.cnt != null) && <span className="railpill" />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="railfoot" id="railFoot">
        <span className="sdot" />
        <span className="stx"><b>Padelgod</b> online<small>WebSocket · 42ms</small></span>
      </div>
    </nav>
  )
}
