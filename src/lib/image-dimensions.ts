// Reads pixel dimensions out of raw image bytes, without decoding the image
// or adding a dependency.
//
// Needed because upstream ships two different things under one field name.
// The Pro Padel League's `hero.image` is a 2560x1440 landscape photo for four
// of its events and a 496x820 portrait POSTER for the other two. Both are
// valid images; only one of them is a cover. Stretched into a landscape card,
// the poster is both distorted and upscaled past its own resolution.
//
// The importer needs to know the real pixel size BEFORE it commits an image
// to a cover slot, and the cheapest honest way to get it is to read the
// header of the bytes it has already downloaded.
//
// Returns null for anything it cannot read with certainty. A caller that gets
// null must fall back, never guess — the whole point is to avoid displaying
// an image in a shape it was not made for.

export interface ImageSize {
  width: number
  height: number
}

/** JPEG markers that stand alone — no length field follows them. */
const JPEG_STANDALONE = new Set([0xd8, 0xd9, 0x01])

/**
 * Start-of-frame markers carry the dimensions. 0xC4 (Huffman table), 0xC8
 * (JPEG extension) and 0xCC (arithmetic coding conditioning) sit in the same
 * numeric range but are NOT frame headers — reading them as such yields
 * convincing nonsense rather than an error.
 */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function readJpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i < b.length) {
    // Segments are byte-aligned on 0xFF; fill bytes are legal padding.
    if (b[i] !== 0xff) { i++; continue }
    let marker = b[i + 1]
    while (marker === 0xff) { i++; marker = b[i + 1] }
    if (JPEG_STANDALONE.has(marker)) { i += 2; continue }
    if (i + 4 > b.length) return null
    const length = (b[i + 2] << 8) | b[i + 3]
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      // SOF payload: precision(1) height(2) width(2)
      if (i + 9 > b.length) return null
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      if (!width || !height) return null
      return { width, height }
    }
    i += 2 + length
  }
  return null
}

function readPng(b: Uint8Array): ImageSize | null {
  // 8-byte signature, then an IHDR chunk whose data starts at byte 16.
  if (b.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return null
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null
  const width = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]
  const height = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export function imageDimensions(bytes: Uint8Array): ImageSize | null {
  return readJpeg(bytes) ?? readPng(bytes)
}

/**
 * Is this image big enough to fill a cover slot?
 *
 * This used to also reject by SHAPE — portrait posters and ultra-wide
 * banners — on the reasoning that neither survives a landscape crop. Looking
 * at the source proved that wrong: propadelleague.com renders the very same
 * 496x820 `vertical.jpg` as its own event hero, as a background-size:cover
 * fill of a 903x500 landscape area, and the skyline reads perfectly. A crop
 * is not damage when the subject survives it.
 *
 * What a crop CANNOT rescue is resolution, so that is all this checks now.
 * The card measures 464x335 CSS px, so an image narrower than that is being
 * enlarged past its own pixels no matter how it is framed.
 *
 * Null dimensions still return false: an image we could not measure is one
 * we cannot make this promise about.
 */
export function isUsableCover(
  size: ImageSize | null,
  opts: { minWidth?: number } = {},
): boolean {
  if (!size) return false
  // The rendered card width. Not a round number by accident — measured.
  return size.width >= (opts.minWidth ?? 460)
}
