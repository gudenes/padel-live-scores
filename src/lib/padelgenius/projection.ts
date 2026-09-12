// src/lib/padelgenius/projection.ts
import type { CourtBounds } from './types'

export const W = 400
export const H = 600

/** y-axis anchor table: [logical y, canvas y in px], monotonic */
function anchors(b: CourtBounds): [number, number][] {
  return [
    [0,   b.backGlassY    * H],
    [33,  b.backServiceY  * H],
    [50,  b.netY          * H],
    [67,  b.nearServiceY  * H],
    [100, b.nearGlassY    * H],
  ]
}

export function toSvg(nx: number, ny: number, bounds: CourtBounds): [number, number] {
  const a = anchors(bounds)
  let svgY = a[a.length - 1][1]
  if (ny <= a[0][0]) svgY = a[0][1]
  else {
    for (let i = 0; i < a.length - 1; i++) {
      const [y0, p0] = a[i]
      const [y1, p1] = a[i + 1]
      if (ny >= y0 && ny <= y1) {
        const t = (ny - y0) / (y1 - y0)
        svgY = p0 + (p1 - p0) * t
        break
      }
    }
  }
  const depthT = (svgY / H - bounds.backGlassY) / (bounds.nearGlassY - bounds.backGlassY)
  const leftEdge  = (bounds.farLeftX  + (bounds.nearLeftX  - bounds.farLeftX)  * depthT) * W
  const rightEdge = (bounds.farRightX + (bounds.nearRightX - bounds.farRightX) * depthT) * W
  const svgX = leftEdge + (nx / 100) * (rightEdge - leftEdge)
  return [svgX, svgY]
}

export function fromSvg(svgX: number, svgY: number, bounds: CourtBounds): [number, number] {
  const a = anchors(bounds)
  const backY = a[0][1]
  const nearY = a[a.length - 1][1]
  if (svgY < backY || svgY > nearY) return [-1, -1]
  let ny = 0
  for (let i = 0; i < a.length - 1; i++) {
    const [y0, p0] = a[i]
    const [y1, p1] = a[i + 1]
    if (svgY >= p0 && svgY <= p1) {
      const t = (svgY - p0) / (p1 - p0)
      ny = y0 + (y1 - y0) * t
      break
    }
  }
  const depthT = (svgY - backY) / (nearY - backY)
  const leftEdge  = (bounds.farLeftX  + (bounds.nearLeftX  - bounds.farLeftX)  * depthT) * W
  const rightEdge = (bounds.farRightX + (bounds.nearRightX - bounds.farRightX) * depthT) * W
  const nx = ((svgX - leftEdge) / (rightEdge - leftEdge)) * 100
  return [nx, ny]
}

export function playerScale(ny: number, vs: { scaleCurveMin: number; scaleCurveMax: number }): number {
  return vs.scaleCurveMin + (ny / 100) * (vs.scaleCurveMax - vs.scaleCurveMin)
}
