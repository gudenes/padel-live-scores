// Round 3: tournament detail page — coverage disclaimer
// "Live point-by-point scoring is not available for this event."

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ALL = {
  en: {
    tournament: {
      noPbpCoverage: 'Live point-by-point scoring is not available for this event.',
      _noPbpCoverage_context: 'Disclaimer shown on the tournament detail page when the event level does not include per-point data from padelapi.org (lower-tier events). Sentence case, ends with period. "Point-by-point" = the granular per-shot scoring data; not "match-by-match".',
    },
  },
  es: {
    tournament: {
      noPbpCoverage: 'La puntuación punto a punto en directo no está disponible para este evento.',
    },
  },
  pt: {
    tournament: {
      noPbpCoverage: 'A pontuação ponto a ponto ao vivo não está disponível para este evento.',
    },
  },
  it: {
    tournament: {
      noPbpCoverage: 'Il punteggio punto per punto in diretta non è disponibile per questo evento.',
    },
  },
  fr: {
    tournament: {
      noPbpCoverage: 'Le scoring point par point en direct n\'est pas disponible pour cet évènement.',
    },
  },
}

function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
      deepMerge(dst[k], v)
    } else {
      dst[k] = v
    }
  }
  return dst
}

async function main() {
  for (const [locale, additions] of Object.entries(ALL)) {
    const path = resolve(root, `src/messages/${locale}.json`)
    const text = await fs.readFile(path, 'utf8')
    const json = JSON.parse(text)
    deepMerge(json, additions)
    const out = JSON.stringify(json, null, 2) + '\n'
    await fs.writeFile(path, out, 'utf8')
    console.log(`✓ ${locale}.json (round 3 — coverage disclaimer)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
