// Round 2: stat-bar labels and tab labels for MatchStatsView.
// These get added under matchDetail.stats.* alongside the empty-state keys
// landed in round 1. Same idempotent merge pattern.

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ALL = {
  en: {
    matchDetail: {
      stats: {
        matchTab: 'Match',
        _matchTab_context: 'Tab label inside the Stats view that shows aggregate match stats (vs per-set). Noun, not verb.',
        setN: 'Set {n}',
        // Service section
        firstServeWon: 'First serve points won',
        secondServeWon: 'Second serve points won',
        serviceGamesPlayed: 'Service games played',
        totalServeWon: 'Total serve points won',
        // Return section
        firstReturnWon: 'First return points won',
        secondReturnWon: 'Second return points won',
        returnGamesPlayed: 'Return games played',
        totalReturnWon: 'Total return points won',
        // Points section
        longestStreak: 'Longest points won streak',
      },
    },
  },
  es: {
    matchDetail: {
      stats: {
        matchTab: 'Partido',
        setN: 'Set {n}',
        firstServeWon: 'Puntos ganados con primer saque',
        secondServeWon: 'Puntos ganados con segundo saque',
        serviceGamesPlayed: 'Juegos al saque',
        totalServeWon: 'Puntos ganados al saque',
        firstReturnWon: 'Puntos ganados al primer resto',
        secondReturnWon: 'Puntos ganados al segundo resto',
        returnGamesPlayed: 'Juegos al resto',
        totalReturnWon: 'Puntos ganados al resto',
        longestStreak: 'Mayor racha de puntos ganados',
      },
    },
  },
  pt: {
    matchDetail: {
      stats: {
        matchTab: 'Jogo',
        setN: 'Set {n}',
        firstServeWon: 'Pontos ganhos no primeiro serviço',
        secondServeWon: 'Pontos ganhos no segundo serviço',
        serviceGamesPlayed: 'Jogos ao serviço',
        totalServeWon: 'Total de pontos ganhos ao serviço',
        firstReturnWon: 'Pontos ganhos na primeira devolução',
        secondReturnWon: 'Pontos ganhos na segunda devolução',
        returnGamesPlayed: 'Jogos ao resto',
        totalReturnWon: 'Total de pontos ganhos ao resto',
        longestStreak: 'Maior sequência de pontos ganhos',
      },
    },
  },
  it: {
    matchDetail: {
      stats: {
        matchTab: 'Partita',
        setN: 'Set {n}',
        firstServeWon: 'Punti vinti con la prima',
        secondServeWon: 'Punti vinti con la seconda',
        serviceGamesPlayed: 'Game al servizio',
        totalServeWon: 'Totale punti vinti al servizio',
        firstReturnWon: 'Punti vinti alla prima risposta',
        secondReturnWon: 'Punti vinti alla seconda risposta',
        returnGamesPlayed: 'Game alla risposta',
        totalReturnWon: 'Totale punti vinti in risposta',
        longestStreak: 'Striscia più lunga di punti vinti',
      },
    },
  },
  fr: {
    matchDetail: {
      stats: {
        matchTab: 'Match',
        setN: 'Set {n}',
        firstServeWon: 'Points gagnés sur premier service',
        secondServeWon: 'Points gagnés sur second service',
        serviceGamesPlayed: 'Jeux de service',
        totalServeWon: 'Total points gagnés au service',
        firstReturnWon: 'Points gagnés sur premier retour',
        secondReturnWon: 'Points gagnés sur second retour',
        returnGamesPlayed: 'Jeux de retour',
        totalReturnWon: 'Total points gagnés en retour',
        longestStreak: 'Plus longue série de points gagnés',
      },
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
    console.log(`✓ ${locale}.json updated (round 2)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
