'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { filterPages, searchEntities, type EntityHit, type PageCommand } from '@/lib/command-palette'

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [entities, setEntities] = useState<EntityHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v) }
      else if (e.key === 'Escape') { setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) { setQ(''); setActive(0); setEntities([]); requestAnimationFrame(() => inputRef.current?.focus()) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const t = setTimeout(() => { searchEntities(q, ctrl.signal).then(setEntities) }, 180)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q, open])

  const pages = useMemo<PageCommand[]>(() => filterPages(q), [q])
  const flat = useMemo(
    () => [
      ...pages.map((p) => ({ href: p.href, label: p.label, sub: p.group })),
      ...entities.map((e) => ({ href: e.href, label: e.label, sub: e.sub ?? e.kind })),
    ],
    [pages, entities],
  )

  // open via custom event (header search box dispatches this)
  useEffect(() => {
    function onOpen() { setOpen(true) }
    window.addEventListener('ops:open-palette', onOpen)
    return () => window.removeEventListener('ops:open-palette', onOpen)
  }, [])

  if (!open) return null

  function go(href: string) { setOpen(false); router.push(href) }

  return (
    <div className="ui-cmd-scrim" onClick={() => setOpen(false)}>
      <div className="ui-cmd" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="ui-cmd-input"
          placeholder="Jump to a page or search players, tournaments…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && flat[active]) { go(flat[active].href) }
          }}
        />
        <div className="ui-cmd-list">
          {pages.length > 0 && <div className="ui-cmd-group">Pages</div>}
          {pages.map((p, i) => (
            <div key={p.href} className="ui-cmd-item" data-active={active === i} onMouseEnter={() => setActive(i)} onClick={() => go(p.href)}>
              <span>{p.label}</span><span className="ui-cmd-item-sub">{p.group}</span>
            </div>
          ))}
          {entities.length > 0 && <div className="ui-cmd-group">Results</div>}
          {entities.map((e, i) => {
            const idx = pages.length + i
            return (
              <div key={`${e.kind}-${e.id}`} className="ui-cmd-item" data-active={active === idx} onMouseEnter={() => setActive(idx)} onClick={() => go(e.href)}>
                <span>{e.label}</span><span className="ui-cmd-item-sub">{e.sub ?? e.kind}</span>
              </div>
            )
          })}
          {flat.length === 0 && <div className="ui-cmd-group">No matches</div>}
        </div>
      </div>
    </div>
  )
}
