import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { composeTeamOverlay } from '../team-overlay'

// Build a transparent WxH PNG with an opaque rw×rh rectangle centered inside,
// so trim() crops it down to exactly rw×rh of the given color.
async function fig(W: number, H: number, rw: number, rh: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  const rect = await sharp({ create: { width: rw, height: rh, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rect, left: Math.floor((W - rw) / 2), top: Math.floor((H - rh) / 2) }])
    .png()
    .toBuffer()
}

async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data } = await sharp(buf).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return [data[0]!, data[1]!, data[2]!, data[3]!]
}

describe('composeTeamOverlay', () => {
  it('overlaps two trimmed figures into a transparent PNG of the expected size, second in front', async () => {
    const a = await fig(200, 400, 80, 300, { r: 255, g: 0, b: 0 })   // trims to 80×300 (red)
    const b = await fig(160, 360, 100, 300, { r: 0, g: 0, b: 255 })  // trims to 100×300 (blue)
    const out = await composeTeamOverlay(a, b, { overlapFraction: 0.25 })
    const m = await sharp(out).metadata()
    // both already 300 tall → targetH 300; wA=80, wB=100; overlap=round(100*0.25)=25
    expect(m.height).toBe(300)
    expect(m.width).toBe(80 + 100 - 25) // 155
    expect(m.hasAlpha).toBe(true)
    const [ar] = await pixel(out, 20, 150); expect(ar).toBeGreaterThan(200)       // red dominant (A-only)
    const bOnly = await pixel(out, 130, 150); expect(bOnly[2]).toBeGreaterThan(200) // blue dominant (B-only)
    const overlap = await pixel(out, 70, 150); expect(overlap[2]).toBeGreaterThan(200) // blue (B in front)
  })

  it('swapping inputs puts the other player in front', async () => {
    const a = await fig(200, 400, 80, 300, { r: 255, g: 0, b: 0 })
    const b = await fig(160, 360, 100, 300, { r: 0, g: 0, b: 255 })
    const out = await composeTeamOverlay(b, a, { overlapFraction: 0.25 }) // a now in front
    const m = await sharp(out).metadata()
    expect(m.width).toBe(100 + 80 - Math.round(80 * 0.25)) // 160
    const overlap = await pixel(out, 95, 150); expect(overlap[0]).toBeGreaterThan(200) // red (a in front)
  })
})
