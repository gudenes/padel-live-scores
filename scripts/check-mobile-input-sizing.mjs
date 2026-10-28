// Run: node scripts/check-mobile-input-sizing.mjs
// Requires Playwright's Chromium and WebKit browsers (npx playwright install).
// Checks browser-computed sizing, not the native iOS keyboard/zoom heuristic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium, webkit } = require('playwright')
const ts = require('typescript')
const root = new URL('../', import.meta.url)
const css = readFileSync(new URL('src/app/globals.css', root), 'utf8')
  .replace(/^@(?:import|plugin).*;$/gm, '')
const source = readFileSync(new URL('src/lib/mobile-input.ts', root), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
new Function('exports', compiled)(exports)
const { mobileInputFontSize } = exports

// Read the real global-search input styles so this also catches a call-site
// regression (e.g. restoring an inline 15px size or removing minWidth).
const search = ts.createSourceFile('SearchOverlay.tsx', readFileSync(new URL('src/components/nav/SearchOverlay.tsx', root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let searchStyle
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(search) === 'input') {
    const style = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(search) === 'style')
    searchStyle = new Function('mobileInputFontSize', `return (${style.initializer.expression.getText(search)})`)(mobileInputFontSize)
  }
  ts.forEachChild(node, visit)
}
visit(search)
assert.ok(searchStyle)

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    for (const device of [
      { name: 'phone', width: 320, height: 568, hasTouch: true },
      { name: 'landscape', width: 844, height: 390, hasTouch: true },
      { name: 'tablet', width: 1024, height: 1366, hasTouch: true },
      { name: 'desktop', width: 1440, height: 900, hasTouch: false },
    ]) {
      const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, hasTouch: device.hasTouch })
      const page = await context.newPage()
      await page.setContent(`<style>${css}</style><main id="fixture"></main>`)
      await page.evaluate(({ styles, sizes }) => {
        const root = document.getElementById('fixture')
        const row = document.createElement('div')
        Object.assign(row.style, { display: 'flex', gap: '10px', padding: '14px 16px', width: '100%', maxWidth: '500px' })
        const input = document.createElement('input')
        input.id = 'search'
        input.placeholder = 'Buscar jugadores, torneos, partidos…'
        // Numeric zero is valid CSS; React's unitless properties stay unitless.
        Object.assign(input.style, styles)
        const close = document.createElement('button')
        close.textContent = '×'
        Object.assign(close.style, { width: '32px', height: '32px', flexShrink: '0' })
        row.append(input, close)
        root.append(row)
        for (const tag of ['input', 'textarea', 'select']) {
          for (const [size, fontSize] of sizes) {
            const control = document.createElement(tag)
            control.dataset.expectedSize = size
            control.style.fontSize = fontSize
            // App selects have custom borders. macOS WebKit's unstyled native
            // popup caps its font at 13px even for a literal font-size:16px;
            // use the same styled-control rendering path as our components.
            if (tag === 'select') control.style.border = '1px solid #2a2a2a'
            root.append(control)
          }
        }
        const label = document.createElement('label')
        label.id = 'label'
        label.style.fontSize = '12px'
        label.textContent = 'Unchanged label'
        root.append(label)
      }, { styles: searchStyle, sizes: [10, 12, 13, 14, 15, 16, 20].map(size => [size, mobileInputFontSize(size)]) })
      const state = await page.evaluate(() => ({
        coarse: matchMedia('(any-pointer: coarse)').matches,
        search: getComputedStyle(document.getElementById('search')).fontSize,
        label: getComputedStyle(document.getElementById('label')).fontSize,
        controls: [...document.querySelectorAll('[data-expected-size]')].map(el => [Number(el.dataset.expectedSize), parseFloat(getComputedStyle(el).fontSize)]),
        searchFits: document.getElementById('search').parentElement.scrollWidth <= document.getElementById('search').parentElement.clientWidth,
      }))
      assert.equal(state.coarse, device.hasTouch, 'Touch emulation must activate the actual CSS media query')
      assert.equal(state.search, device.hasTouch ? '16px' : '15px')
      assert.equal(state.label, '12px')
      assert.equal(state.searchFits, true)
      for (const [original, computed] of state.controls) assert.equal(computed, Math.max(original, device.hasTouch ? 16 : 0), `${engine.name()} ${device.name}: control with desktop size ${original}`)
      await page.locator('#search').focus()
      assert.equal(await page.locator('#search').evaluate(el => getComputedStyle(el).fontSize), state.search)
      console.log(`${engine.name()}: ${device.name} passed`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
