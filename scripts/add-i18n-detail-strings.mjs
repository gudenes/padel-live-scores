// Round 4: tournament detail page leftovers — "PREDICTED" badge,
// "Final not played yet" empty state, and the {count} LIVE chip.

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ALL = {
  en: {
    tournament: {
      predicted: 'PREDICTED',
      _predicted_context: 'Tiny badge indicating that a result was inferred (not from a live feed). Short uppercase word fits the badge.',
      finalNotPlayed: 'Final not played yet',
      checkBackAfterTournament: 'Check back after the tournament ends',
      liveCountChip: '{count} LIVE',
      _liveCountChip_context: 'Small live-match counter chip on the tournament header (e.g. "3 LIVE"). Pluralisation is implicit; if a target locale needs different plural forms, use ICU here.',
    },
  },
  es: {
    tournament: {
      predicted: 'PREVISTO',
      finalNotPlayed: 'La final aún no se ha jugado',
      checkBackAfterTournament: 'Vuelve cuando termine el torneo',
      liveCountChip: '{count} EN VIVO',
    },
  },
  pt: {
    tournament: {
      predicted: 'PREVISTO',
      finalNotPlayed: 'A final ainda não foi disputada',
      checkBackAfterTournament: 'Volta a consultar após o torneio terminar',
      liveCountChip: '{count} AO VIVO',
    },
  },
  it: {
    tournament: {
      predicted: 'PREVISTO',
      finalNotPlayed: 'Finale non ancora giocata',
      checkBackAfterTournament: 'Torna a vedere dopo la fine del torneo',
      liveCountChip: '{count} IN DIRETTA',
    },
  },
  fr: {
    tournament: {
      predicted: 'PRÉVU',
      finalNotPlayed: 'Finale pas encore jouée',
      checkBackAfterTournament: 'Reviens après la fin du tournoi',
      liveCountChip: '{count} EN DIRECT',
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
    console.log(`✓ ${locale}.json (round 4)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
