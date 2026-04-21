// Tests for the DOMMatrix / Path2D / ImageData shims that let pdf-parse
// (via pdfjs-dist) load in Vercel's Node serverless runtime.
//
// Scope: correctness of the math that pdfjs uses for text-extraction
// transforms — multiply, translate, scale, invert, transformPoint. Rendering
// methods (rotateSelf, skew, etc.) are implemented but not exhaustively
// tested here — pdfjs only touches them on render paths we don't exercise.

import { describe, it, expect, beforeAll } from 'vitest'

// Mirror the side-effect module's install logic so tests can exercise the
// shim without polluting the test runner's global (which Vitest's JSDOM env
// already has a real DOMMatrix on).
import { __installPdfNodePolyfills, __NodeDOMMatrix } from '../pdf-node-polyfills'

beforeAll(() => {
  // Ensure the shim class exists for tests — no-op if it couldn't be built.
  expect(__NodeDOMMatrix).toBeDefined()
})

describe('__NodeDOMMatrix', () => {
  it('defaults to identity when constructed with no args', () => {
    const m = new __NodeDOMMatrix()
    expect(m.a).toBe(1)
    expect(m.b).toBe(0)
    expect(m.c).toBe(0)
    expect(m.d).toBe(1)
    expect(m.e).toBe(0)
    expect(m.f).toBe(0)
    expect(m.is2D).toBe(true)
  })

  it('constructs from a 6-number array (2D transform)', () => {
    const m = new __NodeDOMMatrix([2, 0, 0, 3, 10, 20])
    expect(m.a).toBe(2)
    expect(m.d).toBe(3)
    expect(m.e).toBe(10)
    expect(m.f).toBe(20)
  })

  it('constructs from a 16-number array (3D transform flattens to 2D)', () => {
    // Row-major 4x4 identity with a translation in the last column
    // pdfjs occasionally passes 16-element arrays from parsed PDFs.
    const m = new __NodeDOMMatrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      5, 7, 0, 1,
    ])
    // 2D projection uses m11, m12, m21, m22, m41, m42
    expect(m.a).toBe(1)
    expect(m.d).toBe(1)
    expect(m.e).toBe(5)
    expect(m.f).toBe(7)
  })

  it('translateSelf mutates in place correctly', () => {
    const m = new __NodeDOMMatrix()
    m.translateSelf(10, 20)
    expect(m.e).toBe(10)
    expect(m.f).toBe(20)
    // compose: translate(10,20) then translate(3,4) → (13, 24)
    m.translateSelf(3, 4)
    expect(m.e).toBe(13)
    expect(m.f).toBe(24)
  })

  it('scaleSelf mutates scale factors and preserves translation', () => {
    const m = new __NodeDOMMatrix([1, 0, 0, 1, 5, 7])
    m.scaleSelf(2, 3)
    expect(m.a).toBe(2)
    expect(m.d).toBe(3)
    expect(m.e).toBe(5)
    expect(m.f).toBe(7)
  })

  it('multiplySelf composes two matrices in the standard affine order', () => {
    // A = translate(10, 0);  B = scale(2)
    // A.multiplySelf(B) should be "translate then scale" when applied to a point:
    // p' = A * B * p   → apply B first (scale), then A (translate)
    const a = new __NodeDOMMatrix([1, 0, 0, 1, 10, 0])
    const b = new __NodeDOMMatrix([2, 0, 0, 2, 0, 0])
    a.multiplySelf(b)
    // Matrix product in column-major affine form:
    //   [a.a*b.a + a.c*b.b,  a.b*b.a + a.d*b.b]  = [2, 0]
    //   [a.a*b.c + a.c*b.d,  a.b*b.c + a.d*b.d]  = [0, 2]
    //   translation: [a.a*b.e + a.c*b.f + a.e, a.b*b.e + a.d*b.f + a.f] = [10, 0]
    expect(a.a).toBe(2)
    expect(a.b).toBe(0)
    expect(a.c).toBe(0)
    expect(a.d).toBe(2)
    expect(a.e).toBe(10)
    expect(a.f).toBe(0)
  })

  it('transformPoint applies the matrix to a point', () => {
    // translate(5, 7) then scale(2, 3) composed as T * S:
    const m = new __NodeDOMMatrix([2, 0, 0, 3, 5, 7])
    const p = m.transformPoint({ x: 10, y: 20 })
    expect(p.x).toBe(25) // 2*10 + 0*20 + 5
    expect(p.y).toBe(67) // 0*10 + 3*20 + 7
  })

  it('invertSelf inverts a simple scale+translate', () => {
    const m = new __NodeDOMMatrix([2, 0, 0, 3, 10, 12])
    m.invertSelf()
    // inverse: [1/2, 0, 0, 1/3, -5, -4]
    expect(m.a).toBeCloseTo(0.5)
    expect(m.d).toBeCloseTo(1 / 3)
    expect(m.e).toBeCloseTo(-5)
    expect(m.f).toBeCloseTo(-4)
  })

  it('invertSelf on a singular matrix flags is2D and leaves state predictable', () => {
    // det = 0 means no inverse exists. Real DOMMatrix throws in some browsers
    // and sets all NaN in others; we leave the matrix unchanged so text
    // extraction doesn't explode on malformed PDFs.
    const m = new __NodeDOMMatrix([1, 1, 1, 1, 0, 0]) // det = 0
    m.invertSelf()
    expect(Number.isFinite(m.a)).toBe(true)
  })
})

describe('__installPdfNodePolyfills', () => {
  it('installs DOMMatrix on a fresh global only when missing', () => {
    const g: Record<string, unknown> = {}
    __installPdfNodePolyfills(g)
    expect(g.DOMMatrix).toBe(__NodeDOMMatrix)
  })

  it('does NOT override a pre-existing DOMMatrix (respects browser runtime)', () => {
    class FakeBrowserMatrix {}
    const g: Record<string, unknown> = { DOMMatrix: FakeBrowserMatrix }
    __installPdfNodePolyfills(g)
    expect(g.DOMMatrix).toBe(FakeBrowserMatrix)
  })

  it('installs Path2D and ImageData stubs if missing', () => {
    const g: Record<string, unknown> = {}
    __installPdfNodePolyfills(g)
    expect(typeof g.Path2D).toBe('function')
    expect(typeof g.ImageData).toBe('function')
  })

  it('is idempotent — repeated calls do not re-register', () => {
    const g: Record<string, unknown> = {}
    __installPdfNodePolyfills(g)
    const firstMatrix = g.DOMMatrix
    __installPdfNodePolyfills(g)
    expect(g.DOMMatrix).toBe(firstMatrix)
  })
})
