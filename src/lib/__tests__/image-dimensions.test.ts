import { describe, it, expect } from 'vitest'
import { imageDimensions, isUsableCover } from '../image-dimensions'

/** Minimal JPEG: SOI, optional segments, then a SOF carrying h/w. */
function jpeg(
  width: number,
  height: number,
  opts: { sofMarker?: number; before?: number[] } = {},
): Uint8Array {
  const sof = opts.sofMarker ?? 0xc0
  return new Uint8Array([
    0xff, 0xd8,
    ...(opts.before ?? []),
    0xff, sof, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00,
  ])
}

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  b.set([(width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff], 16)
  b.set([(height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff], 20)
  return b
}

describe('imageDimensions — JPEG', () => {
  it('reads the two real shapes upstream ships', () => {
    // Measured from propadelleague.com: hero.jpg is a landscape photo,
    // vertical.jpg is a portrait poster. Both arrive in `hero.image`.
    expect(imageDimensions(jpeg(2560, 1440))).toEqual({ width: 2560, height: 1440 })
    expect(imageDimensions(jpeg(496, 820))).toEqual({ width: 496, height: 820 })
  })

  it('reads progressive JPEGs too', () => {
    expect(imageDimensions(jpeg(1200, 800, { sofMarker: 0xc2 }))).toEqual({ width: 1200, height: 800 })
  })

  it('skips segments that precede the frame header', () => {
    // A real JPEG opens with APP0/APP1 (JFIF, EXIF) before any SOF.
    const app0 = [0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]
    expect(imageDimensions(jpeg(640, 480, { before: app0 }))).toEqual({ width: 640, height: 480 })
  })

  it('does NOT mistake a Huffman table for a frame header', () => {
    // 0xC4 sits inside the 0xC0-0xCF range but is not a SOF. Reading it as
    // one yields plausible-looking numbers rather than an error, which is
    // the dangerous kind of wrong.
    // Length 0x0004 means two payload bytes follow it — the segment is six
    // bytes in total. Getting this wrong makes the parser run off the end,
    // which is how the first version of this fixture failed.
    const dht = [0xff, 0xc4, 0x00, 0x04, 0x08, 0x02]
    expect(imageDimensions(jpeg(1920, 1080, { before: dht }))).toEqual({ width: 1920, height: 1080 })
  })

  it('tolerates 0xFF fill bytes before a marker', () => {
    expect(imageDimensions(jpeg(800, 600, { before: [0xff, 0xff] }))).toEqual({ width: 800, height: 600 })
  })

  it('returns null rather than a guess on truncated or foreign bytes', () => {
    expect(imageDimensions(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(imageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(imageDimensions(new Uint8Array(0))).toBeNull()
  })
})

describe('imageDimensions — PNG', () => {
  it('reads IHDR', () => {
    expect(imageDimensions(png(1024, 512))).toEqual({ width: 1024, height: 512 })
  })

  it('rejects a PNG signature with no IHDR', () => {
    const b = png(10, 10)
    b.set([0x49, 0x44, 0x41, 0x54], 12) // 'IDAT'
    expect(imageDimensions(b)).toBeNull()
  })
})

describe('isUsableCover', () => {
  it('accepts the landscape hero', () => {
    expect(isUsableCover({ width: 2560, height: 1440 })).toBe(true)
  })

  it('rejects the portrait poster — wrong shape', () => {
    // Stretched into a landscape card this is distorted, not merely small.
    expect(isUsableCover({ width: 496, height: 820 })).toBe(false)
  })

  it('rejects a landscape image too narrow to fill a card — upscaled to blur', () => {
    // Right shape, wrong resolution. A separate failure from the above, and
    // it has to be caught separately or a 400px-wide banner sails through.
    expect(isUsableCover({ width: 600, height: 300 })).toBe(false)
  })

  it('rejects the ultra-wide banner — cropped to its middle half', () => {
    // Los Angeles, both divisions: 1440x382. Right orientation, but in a
    // ~16:9 slot object-fit:cover shows roughly the middle 47% of its width,
    // which is exactly where an event banner's branding tends not to be.
    expect(isUsableCover({ width: 1440, height: 382 })).toBe(false)
  })

  it('accepts both real landscape shapes', () => {
    expect(isUsableCover({ width: 2560, height: 1440 })).toBe(true) // Playa del Carmen
    expect(isUsableCover({ width: 2132, height: 1096 })).toBe(true) // Miami
  })

  it('refuses when the size could not be read', () => {
    // Unmeasurable is not the same as fine. Committing an unknown image to a
    // cover slot is the exact gamble this module exists to avoid.
    expect(isUsableCover(null)).toBe(false)
  })

  it('honours overridden thresholds', () => {
    expect(isUsableCover({ width: 600, height: 300 }, { minWidth: 500 })).toBe(true)
    expect(isUsableCover({ width: 2560, height: 1440 }, { minRatio: 2 })).toBe(false)
  })
})
