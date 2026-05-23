// src/lib/pdf-node-polyfills.ts
// Minimal browser-API shims for pdfjs-dist (pdf-parse's dependency) when
// running in Node.js serverless environments (Vercel functions).
//
// pdfjs-dist references `DOMMatrix` at module-init time — it fails to IMPORT
// with `ReferenceError: DOMMatrix is not defined` unless we populate the
// global first. Path2D and ImageData are referenced elsewhere in pdfjs; we
// stub them defensively so pdfjs's module-init doesn't blow up on a future
// version bump, even though text-extraction paths don't call them.
//
// Scope: ONLY what pdfjs text extraction (getTextContent) exercises. We do
// NOT implement rendering-specific methods (skew, rotate3d, etc.) to any
// spec-level of fidelity — stubs are present so pdfjs module init doesn't
// throw, but calling them on real data isn't supported.
//
// This file is a SIDE-EFFECT module — import it purely for its effect on
// `globalThis`:
//     import './pdf-node-polyfills'
//
// The shim ONLY installs when the global is missing. In a browser or a
// jsdom-backed test environment, the real DOMMatrix is preserved.

// ── DOMMatrix shim ────────────────────────────────────────────────
// 2D affine matrix:
//   | a  c  e |
//   | b  d  f |
//   | 0  0  1 |
// W3C spec maps this to m11=a, m12=b, m21=c, m22=d, m41=e, m42=f (m13/m23/
// m14/m24/m31..m34/m43/m44 encode the 3D extension; pdfjs only touches 2D
// so we flatten 3D input down to 2D on construction).

class NodeDOMMatrix {
  a: number = 1
  b: number = 0
  c: number = 0
  d: number = 1
  e: number = 0
  f: number = 0
  is2D: boolean = true

  constructor(init?: number[] | Float32Array | Float64Array | string) {
    if (init == null) return
    if (typeof init === 'string') {
      // pdfjs never passes CSS transform strings. Ignore for the stub and
      // leave the matrix as identity — safer than a partial parse.
      return
    }
    const arr = init as ArrayLike<number>
    if (arr.length === 6) {
      this.a = +arr[0]!
      this.b = +arr[1]!
      this.c = +arr[2]!
      this.d = +arr[3]!
      this.e = +arr[4]!
      this.f = +arr[5]!
      return
    }
    if (arr.length === 16) {
      // 4x4 column-major. For 2D projection we pick m11, m12, m21, m22, m41, m42.
      // Source index layout (column-major):
      //   [m11, m12, m13, m14, m21, m22, m23, m24, m31, m32, m33, m34, m41, m42, m43, m44]
      this.a = +arr[0]!
      this.b = +arr[1]!
      this.c = +arr[4]!
      this.d = +arr[5]!
      this.e = +arr[12]!
      this.f = +arr[13]!
      this.is2D = false
      return
    }
    // Any other length: leave as identity.
  }

  // ── Mutating operations ────────────────────────────────────────

  multiplySelf(other: NodeDOMMatrix | { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    const { a, b, c, d, e, f } = this
    this.a = a * other.a + c * other.b
    this.b = b * other.a + d * other.b
    this.c = a * other.c + c * other.d
    this.d = b * other.c + d * other.d
    this.e = a * other.e + c * other.f + e
    this.f = b * other.e + d * other.f + f
    return this
  }

  preMultiplySelf(other: NodeDOMMatrix): this {
    const { a, b, c, d, e, f } = this
    this.a = other.a * a + other.c * b
    this.b = other.b * a + other.d * b
    this.c = other.a * c + other.c * d
    this.d = other.b * c + other.d * d
    this.e = other.a * e + other.c * f + other.e
    this.f = other.b * e + other.d * f + other.f
    return this
  }

  translateSelf(tx = 0, ty = 0, _tz = 0): this {
    this.e += this.a * tx + this.c * ty
    this.f += this.b * tx + this.d * ty
    return this
  }

  scaleSelf(sx = 1, sy?: number, _sz = 1, _ox = 0, _oy = 0, _oz = 0): this {
    const y = sy == null ? sx : sy
    this.a *= sx
    this.b *= sx
    this.c *= y
    this.d *= y
    return this
  }

  rotateSelf(angle = 0, _originY = 0, _originZ = 0): this {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const { a, b, c, d } = this
    this.a = a * cos + c * sin
    this.b = b * cos + d * sin
    this.c = a * -sin + c * cos
    this.d = b * -sin + d * cos
    return this
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c
    if (det === 0 || !Number.isFinite(det)) {
      // Singular — leave unchanged rather than producing NaN soup. Real
      // DOMMatrix sets all m* to NaN and is2D=false; we take the softer
      // path so pdfjs's text loop doesn't divide by NaN downstream.
      return this
    }
    const a = this.d / det
    const b = -this.b / det
    const c = -this.c / det
    const d = this.a / det
    const e = -(a * this.e + c * this.f)
    const f = -(b * this.e + d * this.f)
    this.a = a
    this.b = b
    this.c = c
    this.d = d
    this.e = e
    this.f = f
    return this
  }

  // ── Non-mutating operations ────────────────────────────────────

  multiply(other: NodeDOMMatrix): NodeDOMMatrix {
    const out = new NodeDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f])
    out.multiplySelf(other)
    return out
  }

  translate(tx = 0, ty = 0): NodeDOMMatrix {
    const out = new NodeDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f])
    out.translateSelf(tx, ty)
    return out
  }

  scale(sx = 1, sy?: number): NodeDOMMatrix {
    const out = new NodeDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f])
    out.scaleSelf(sx, sy)
    return out
  }

  inverse(): NodeDOMMatrix {
    const out = new NodeDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f])
    out.invertSelf()
    return out
  }

  transformPoint(p: { x: number; y: number; z?: number; w?: number }): { x: number; y: number; z: number; w: number } {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f,
      z: p.z ?? 0,
      w: p.w ?? 1,
    }
  }

  toFloat32Array(): Float32Array {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f])
  }
}

// Exported for tests only. External callers use the side-effect import.
export const __NodeDOMMatrix = NodeDOMMatrix

// ── Path2D and ImageData stubs ────────────────────────────────────
// pdfjs references these in rendering paths we don't exercise. Stub them so
// the pdfjs module can load; calling the methods doesn't need to do anything
// useful for text extraction.

class NodePath2D {
  // Stubs mirror the Canvas Path2D API surface. All no-ops.
  addPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  arcTo(): void {}
  ellipse(): void {}
  rect(): void {}
}

class NodeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
    if (typeof widthOrData === 'number') {
      this.width = widthOrData
      this.height = heightOrWidth ?? 0
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = widthOrData
      this.width = heightOrWidth ?? 0
      this.height = height ?? 0
    }
  }
}

// ── Installer ─────────────────────────────────────────────────────

/**
 * Install the Node-side shims on the given global object if they're missing.
 * Idempotent — safe to call repeatedly. In a browser or jsdom environment
 * the native classes are kept.
 *
 * Exported for testability (so tests can exercise the install logic without
 * touching the real globalThis). Normal runtime usage is the side-effect
 * below.
 */
export function __installPdfNodePolyfills(g: Record<string, unknown>): void {
  if (g.DOMMatrix == null) g.DOMMatrix = NodeDOMMatrix
  if (g.Path2D == null) g.Path2D = NodePath2D
  if (g.ImageData == null) g.ImageData = NodeImageData
}

// Side effect on import: patch the real globalThis.
__installPdfNodePolyfills(globalThis as unknown as Record<string, unknown>)
