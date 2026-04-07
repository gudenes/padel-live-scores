'use client'
// src/app/loading-test/page.tsx
// Test/preview page for the BrandedLoader. Lets you cycle through every
// hint preset and see the animation. Visit: /loading-test

import { useState } from 'react'
import BrandedLoader, { LOADER_HINTS } from '@/app/components/BrandedLoader'

const PRESETS = Object.entries(LOADER_HINTS) as Array<[keyof typeof LOADER_HINTS, readonly string[]]>

export default function LoadingTestPage() {
  const [presetIdx, setPresetIdx] = useState(0)
  const [logoSize, setLogoSize] = useState(56)
  const [showDots, setShowDots] = useState(true)
  const [rotateMs, setRotateMs] = useState(2000)
  const [customHints, setCustomHints] = useState('')

  const [presetKey, presetHints] = PRESETS[presetIdx]
  const customSplit = customHints.split('\n').map(h => h.trim()).filter(Boolean)
  const hints = customSplit.length > 0 ? customSplit : [...presetHints]

  return (
    <div style={{ minHeight: '100dvh', background: '#1A1A1A', color: '#fff', padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>BrandedLoader Test</h1>
      <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>
        Preview the loader with different hint sets and tune the parameters.
        Production usage: import from <code style={{ background: '#0A0A0A', padding: '1px 6px', borderRadius: 3 }}>@/app/components/BrandedLoader</code>.
      </p>

      {/* Controls */}
      <div style={{
        background: '#0A0A0A', border: '1px solid #2a2a2a', borderRadius: 8,
        padding: 14, marginBottom: 16, display: 'grid', gap: 12,
      }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginBottom: 5 }}>
            Hint preset (or enter custom below)
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(([key], i) => (
              <button
                key={key}
                onClick={() => { setPresetIdx(i); setCustomHints('') }}
                style={{
                  fontSize: 11, fontWeight: 600,
                  padding: '5px 11px', borderRadius: 999,
                  border: 'none', cursor: 'pointer',
                  background: i === presetIdx && customSplit.length === 0 ? '#7ED321' : '#2a2a2a',
                  color: i === presetIdx && customSplit.length === 0 ? '#000' : '#fff',
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginBottom: 5 }}>
            Custom hints (one per line, overrides preset)
          </label>
          <textarea
            value={customHints}
            onChange={e => setCustomHints(e.target.value)}
            placeholder={'Loading custom thing...\nAlmost ready...'}
            rows={4}
            style={{
              width: '100%', background: '#1A1A1A', color: '#fff',
              border: '1px solid #2a2a2a', borderRadius: 6, padding: '8px 10px',
              fontFamily: 'inherit', fontSize: 12, resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#9CA3AF' }}>
            Logo size
            <input
              type="range" min="32" max="120" value={logoSize}
              onChange={e => setLogoSize(Number(e.target.value))}
              style={{ display: 'block', width: 160 }}
            />
            <span style={{ fontSize: 10, color: '#7ED321' }}>{logoSize}px</span>
          </label>
          <label style={{ fontSize: 11, color: '#9CA3AF' }}>
            Rotate speed
            <input
              type="range" min="500" max="5000" step="250" value={rotateMs}
              onChange={e => setRotateMs(Number(e.target.value))}
              style={{ display: 'block', width: 160 }}
            />
            <span style={{ fontSize: 10, color: '#7ED321' }}>{rotateMs}ms</span>
          </label>
          <label style={{ fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }}>
            <input type="checkbox" checked={showDots} onChange={e => setShowDots(e.target.checked)} />
            Show progress dots
          </label>
        </div>

        <div style={{ fontSize: 10, color: '#6B7280', borderTop: '1px solid #2a2a2a', paddingTop: 10 }}>
          Active preset: <code style={{ color: '#7ED321' }}>{presetKey}</code> · {hints.length} hints rotating every {rotateMs}ms
        </div>
      </div>

      {/* Live preview */}
      <div style={{
        border: '1px dashed #2a2a2a', borderRadius: 8,
        background: 'linear-gradient(180deg, #1A1A1A 0%, #0F0F0F 100%)',
      }}>
        {/* re-mount on changes so animations restart */}
        <BrandedLoader
          key={`${presetIdx}-${customHints}-${logoSize}-${showDots}-${rotateMs}`}
          hints={hints}
          logoSize={logoSize}
          showDots={showDots}
          rotateMs={rotateMs}
        />
      </div>

      <div style={{ marginTop: 14, fontSize: 10, color: '#6B7280', textAlign: 'center' }}>
        Hints visible: {hints.join(' · ')}
      </div>
    </div>
  )
}
