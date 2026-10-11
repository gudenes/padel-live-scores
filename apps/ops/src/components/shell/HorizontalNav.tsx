'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../IconSprite'
import { GROUPS, activeDestination, tournamentLinks, workspaceGroups } from './navigation'

export function HorizontalNav() {
  const pathname = usePathname(), active = activeDestination(pathname)
  const nav = useRef<HTMLElement>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let alive = true
    const load = async () => {
      const entries = await Promise.all(['/player-suggestions', '/player-claims'].map(async route => {
        try { const response = await fetch('/api/internal' + route + '/count'); if (!response.ok) return [route, 0] as const; const result = await response.json(); return [route, typeof result.count === 'number' ? result.count : 0] as const } catch { return [route, 0] as const }
      }))
      if (alive) setCounts(Object.fromEntries(entries))
    }
    void load(); const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !nav.current?.contains(event.target)) nav.current?.querySelectorAll('details[open]').forEach(el => el.removeAttribute('open')) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  const close = () => nav.current?.querySelectorAll('details[open]').forEach(el => el.removeAttribute('open'))
  const link = (item: (typeof GROUPS)[number]['items'][number]) => <div key={item.href}>
    <Link href={item.href} onClick={close} className={`workspace-link ${active === item.href ? 'is-active' : ''}`} aria-current={active === item.href ? 'page' : undefined}>
      <Icon id={item.icon} /><span>{item.label}</span>{counts[item.href] > 0 && <span className="workspace-count">{counts[item.href]}</span>}
    </Link>
    {item.children?.map(child => <Link key={child.href} href={child.href} onClick={close} className="workspace-sub-link" aria-current={active === child.href ? 'page' : undefined}>{child.label}</Link>)}
  </div>
  return <nav className="horizontal-nav" aria-label="Main navigation" ref={nav} onKeyDown={event => {
    if (event.key === 'Escape') { const open = nav.current?.querySelector('details[open]'); close(); (open?.querySelector('summary') as HTMLElement | null)?.focus(); event.preventDefault() }
  }}>
    <Link href="/today" className="top-link" aria-current={active === '/today' ? 'page' : undefined}><Icon id="today" />Today</Link>
    <Link href="/scouting" className="top-link" aria-current={active === '/scouting' ? 'page' : undefined}><Icon id="users" />Matches</Link>
    <details className="top-dropdown" name="admin-navigation">
      <summary className={`top-link ${tournamentLinks.some(item => item.href === active) ? 'is-active' : ''}`}>Tournaments <span aria-hidden="true">⌄</span></summary>
      <div className="top-dropdown-panel tournament-panel">{tournamentLinks.map(link)}</div>
    </details>
    <details className="top-dropdown" name="admin-navigation">
      <summary className={`top-link ${workspaceGroups.some(group => group.items.some(item => item.href === active || item.children?.some(child => child.href === active))) ? 'is-active' : ''}`}><Icon id="grid" />Workspace <span aria-hidden="true">⌄</span></summary>
      <div className="top-dropdown-panel workspace-panel">{workspaceGroups.map((group, index) => <section key={group.label ?? index}><h2>{group.label ?? 'Console'}</h2>{group.items.map(link)}</section>)}</div>
    </details>
  </nav>
}
