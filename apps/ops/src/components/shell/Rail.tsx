'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { Icon } from '../IconSprite'

type SubItem = { href: string; label: string }
type Item = { href: string; label: string; icon: string; pill?: 'live'; cnt?: number; children?: SubItem[] }
type Group = { label?: string; items: Item[] }

const GROUPS: Group[] = [
  { items: [
    { href: '/today', label: 'Today', icon: 'today' },
    { href: '/odds', label: 'Live Odds', icon: 'odds', pill: 'live', children: [
      { href: '/odds', label: 'Overview' },
      { href: '/odds/calibration', label: 'Calibration' },
      { href: '/odds/methodology', label: 'Methodology' },
    ] },
  ]},
  { label: 'Tournament Ops', items: [
    { href: '/tournament-explorer', label: 'Tournament Explorer', icon: 'grid' },
    { href: '/entry-lists', label: 'Entry Lists', icon: 'list' },
    { href: '/needs-review', label: 'Needs Review', icon: 'flag' },
    { href: '/simulator', label: 'Simulator', icon: 'play' },
  ]},
  { label: 'Catalogs', items: [
    { href: '/players', label: 'Players', icon: 'users' },
    { href: '/brands', label: 'Brands', icon: 'tag' },
    { href: '/streams', label: 'Streams', icon: 'video' },
    { href: '/yt-channels', label: 'YouTube Channels', icon: 'yt' },
    { href: '/partners', label: 'Partners', icon: 'share' },
  ]},
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
  ]},
  { label: 'System', items: [
    { href: '/system/integration-health', label: 'Integration Health', icon: 'heart' },
    { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
    { href: '/system/padelgod-health', label: 'Padelgod Health', icon: 'server' },
    { href: '/system/shadow-mode', label: 'Shadow Mode', icon: 'eye' },
    { href: '/system/coverage-matrix', label: 'Coverage Matrix', icon: 'matrix' },
    { href: '/system/feature-flags', label: 'Feature Flags', icon: 'toggle' },
    { href: '/system/ocr-health', label: 'OCR Health', icon: 'doc' },
    { href: '/system/seo', label: 'SEO', icon: 'search' },
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
                const activeChild = it.children
                  ?.filter(c => pathname === c.href || pathname.startsWith(c.href + '/'))
                  .sort((a, b) => b.href.length - a.href.length)[0]?.href
                return (
                  <div key={it.href}>
                    <Link
                      href={it.href}
                      className={`nav ${it.children ? 'section' : ''} ${active ? (it.children ? 'section-active' : 'active') : ''}`}
                      data-tip={it.label}
                    >
                      <Icon id={it.icon} />
                      <span className="lbl">{it.label}</span>
                      {it.pill === 'live' && <span className="pill"><span className="d" />LIVE</span>}
                      {it.cnt != null && <span className="cnt">{it.cnt}</span>}
                      {(it.pill || it.cnt != null) && <span className="railpill" />}
                    </Link>
                    {it.children && active && !collapsed && (
                      <div className="subnav">
                        {it.children.map(c => (
                          <Link key={c.href} href={c.href} className={activeChild === c.href ? 'active' : ''}>
                            {c.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
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
