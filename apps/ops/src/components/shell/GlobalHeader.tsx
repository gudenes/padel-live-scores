'use client'
import { useState } from 'react'
import { useTheme } from './ThemeProvider'
import { useBrand, BRANDS, type Brand } from './BrandProvider'
import { Icon } from '../../app/(app)/live-odds/_components/icons'

export function GlobalHeader() {
  const { theme, toggle } = useTheme()
  const { brand, setBrand } = useBrand()
  const [menuOpen, setMenuOpen] = useState(false)
  const b = BRANDS[brand]
  return (
    <header className="gheader">
      <div className="brand" onMouseLeave={() => setMenuOpen(false)}>
        <button className="brandbtn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
          <span className={`mark ${brand === 'labs' ? 'labs' : ''}`}>
            {b.markGlyph === 'paddle'
              ? <img src="/brand/padel-nachos-paddle.png" alt="" />
              : <span className="labglyph" style={{ display: 'block' }}>L</span>}
          </span>
          <span className="wmwrap">
            <span className="wm">{b.wordmark}<span className="n" style={brand === 'labs' ? { color: 'var(--lime-text)' } : undefined}>{b.accentWord}</span></span>
            <span className="wmsub"><span className="tag">ADMIN</span>{b.host}</span>
          </span>
          <span className="bchev">▾</span>
        </button>
        <div className={`brandmenu ${menuOpen ? 'open' : ''}`} role="menu">
          <div className="bm-h">Switch workspace</div>
          {(Object.keys(BRANDS) as Brand[]).map(key => (
            <div key={key} className={`bm-i ${key === 'labs' ? 'labs' : ''} ${brand === key ? 'on' : ''}`} role="menuitem"
                 onClick={() => { setBrand(key); setMenuOpen(false) }}>
              <span className="bm-mk">{key === 'nachos' ? <img src="/brand/padel-nachos-paddle.png" alt="" /> : 'L'}</span>
              <span className="bm-tx"><b>Padel {key === 'nachos' ? 'Nachos' : 'Labs'}</b><span>{BRANDS[key].host}</span></span>
              <span className="bm-ck">✓</span>
            </div>
          ))}
        </div>
      </div>

      <label className="gsearch">
        <Icon id="search" />
        <input placeholder="Search matches, players, tournaments, pages…" />
        <kbd>⌘K</kbd>
      </label>

      <div className="gright">
        <span className="envpill"><span className="d" />Prod</span>
        <button className="iconbtn" onClick={toggle} aria-label="Toggle theme">
          <Icon id={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <button className="iconbtn" aria-label="Notifications"><Icon id="bell" /><span className="nd" /></button>
        <span className="avatar">PN</span>
      </div>
    </header>
  )
}
