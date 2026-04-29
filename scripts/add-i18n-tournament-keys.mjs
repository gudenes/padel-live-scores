// scripts/add-i18n-tournament-keys.mjs
//
// One-shot codemod to extend src/messages/{en,es,pt,it,fr}.json with the
// new keys needed to fully internationalise the tournament surfaces +
// the misc untranslated components (search overlay, match stats,
// country picker, aria-label sweep). Run with:
//   node scripts/add-i18n-tournament-keys.mjs
//
// Designed to be idempotent — re-running it overwrites only the keys
// listed below, leaves everything else alone.
//
// Naming convention: every ambiguous key has a sibling `_<key>_context`
// note explaining the disambiguation for translators (per the user's
// memory feedback note feedback_translation_context.md).

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── Per-locale string tables ──────────────────────────────────────
//
// Source-of-truth strings are en. Translations follow with the same
// shape. Where a string is a proper noun and shouldn't translate we
// repeat the English. ES strings reuse the existing copy that was
// previously hardcoded inside TournamentsFilterSheet.tsx.

const ALL = {
  en: {
    common: {
      close: 'Close',
      dismiss: 'Dismiss',
      clear: 'Clear',
      apply: 'Apply',
      shareApp: 'Share PadelNachos',
      changeLanguage: 'Change language',
      tbd: 'TBD',
      _tbd_context: 'Abbreviation for "To Be Determined" — used when a player slot in a draw isn\'t known yet. Keep abbreviation if natural; otherwise translate to a short phrase.',
    },
    home: {
      filtersButton: 'Filters',
      eventsCount: '{count, plural, one {# event} other {# events}}',
      _eventsCount_context: 'Pluralised event counter shown next to the Filters button. Romance languages: feminine plural agreement.',
      tournamentTabs: {
        premier: 'Premier Padel',
        fip: 'FIP Tour',
        _context: 'Premier Padel and FIP are organisations — proper nouns. Do NOT translate.',
      },
      fipTier: {
        all: 'All',
        _all_context: 'Filter chip meaning "all FIP tiers". Feminine plural in Spanish (Todas) because it agrees with implied "tournaments".',
        platinum: 'Platinum',
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        beyond: 'Beyond',
        promises: 'Promises',
        _tier_context: 'Platinum/Gold/Silver/Bronze/Beyond/Promises are FIP tournament tier proper nouns. Do NOT translate.',
      },
      tournamentList: {
        completedYear: 'Completed — {year}',
        _completedYear_context: 'Section header for past tournaments grouped by calendar year. "Completed" is an adjective agreeing with "tournaments" — feminine plural in Romance languages.',
        viewMatches: 'View Matches',
        viewEvent: 'View',
        _viewEvent_context: 'Short CTA on a tournament card. Verb meaning "look at" / "see". ES: "Ver".',
        daysLabel: 'DAYS',
        _daysLabel_context: 'Standalone uppercase label below a numeric countdown (e.g. "14 / DAYS"). Translation may keep all-caps if natural; otherwise short word.',
        daysCount: '{count, plural, one {# day} other {# days}}',
        removeFilter: 'Remove {label}',
        _removeFilter_context: 'aria-label on the X button of an active-filter chip. {label} is the filter name (e.g. "2025", country code).',
      },
      filterSheet: {
        title: 'Filters',
        season: 'Season',
        currentBadge: 'current',
        _currentBadge_context: 'Tiny inline badge appended to the current-year button — short "now"/"this one" indicator.',
        searchEvent: 'Search event',
        searchEventPlaceholder: 'e.g. Brussels, Madrid, FIP Silver…',
        country: 'Country',
        searchCountry: 'Search country…',
        noCountriesInFilter: 'No countries match this filter.',
        noCountryMatchSearch: 'No country matches your search.',
        countriesCount: '{count, plural, one {# country} other {# countries}}',
        region: {
          europe: 'Europe',
          latam: 'Latin America',
          middleEast: 'Middle East',
          asiaOceania: 'Asia / Oceania',
          africa: 'Africa',
          other: 'Other',
        },
        when: 'When',
        whenAll: 'All dates',
        whenThisMonth: 'This month',
        whenNext30: 'Next 30 days',
        whenNext90: 'Next 90 days',
        whenChip: {
          thisMonth: 'This month',
          next30: '30 days',
          next90: '90 days',
          _context: 'Compact labels used inside an active-filter chip (the chip is small, so the words drop "Next").',
        },
        status: 'Status',
        _status_context: 'Adjectives describing tournament state. Feminine plural in Romance languages because they agree with "tournaments".',
        statusLive: 'Live',
        statusUpcoming: 'Upcoming',
        statusCompleted: 'Completed',
        statusFilterLabel: 'Status',
        applyWithCount: 'Apply ({count, plural, one {# event} other {# events}})',
      },
      spotlight: {
        dayOf: 'Day {elapsed} of {total}',
        matchesCount: '{count, plural, one {# match} other {# matches}}',
      },
    },
    tournament: {
      events: 'Events',
      _events_context: 'Header on the tournaments listing page. Plural noun "tournaments". ES: "Eventos".',
      bracket: {
        noDrawForCategory: 'No draw data available for this category.',
      },
    },
    matchDetail: {
      stats: {
        title: 'Stats',
        _title_context: 'Tab/section title — short for "Statistics".',
        noData: 'No data',
        matchNotStarted: "Match hasn't started yet",
        notAvailable: 'Stats not available for this match',
        comingSoon: 'Stats coming soon — sync runs hourly',
        empty: 'No stats data',
        service: 'Service',
        _service_context: 'Padel/tennis section header — the act of serving the ball, not "customer service". ES: "Saque". IT: "Servizio". PT: "Serviço". FR: "Service".',
        return: 'Return',
        _return_context: 'Padel/tennis section header — returning a serve, not "go back". ES: "Resto". IT: "Risposta". PT: "Devolução". FR: "Retour".',
        points: 'Points',
      },
    },
    nav: {
      search: {
        placeholder: 'Search players, tournaments, matches...',
        closeAria: 'Close search',
        typePlayers: 'Players',
        typeTournaments: 'Tournaments',
        typeMatches: 'Matches',
        categoryMen: 'Men',
        categoryWomen: 'Women',
      },
    },
    country: {
      useMyLocation: 'Use my location (auto)',
      searchPlaceholder: 'Search country…',
      searchAria: 'Search country',
      clearAria: 'Clear search',
      noMatch: 'No country matches "{query}"',
    },
  },

  // ── Spanish ──────────────────────────────────────────────────
  // Reuses strings already hardcoded inside TournamentsFilterSheet.tsx
  // so no new translation work for those.
  es: {
    common: {
      close: 'Cerrar',
      dismiss: 'Descartar',
      clear: 'Limpiar',
      apply: 'Aplicar',
      shareApp: 'Compartir PadelNachos',
      changeLanguage: 'Cambiar idioma',
      tbd: 'POR DEFINIR',
    },
    home: {
      filtersButton: 'Filtros',
      eventsCount: '{count, plural, one {# evento} other {# eventos}}',
      tournamentTabs: {
        premier: 'Premier Padel',
        fip: 'FIP Tour',
      },
      fipTier: {
        all: 'Todas',
        platinum: 'Platinum',
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        beyond: 'Beyond',
        promises: 'Promises',
      },
      tournamentList: {
        completedYear: 'Completados — {year}',
        viewMatches: 'Ver partidos',
        viewEvent: 'Ver',
        daysLabel: 'DÍAS',
        daysCount: '{count, plural, one {# día} other {# días}}',
        removeFilter: 'Quitar {label}',
      },
      filterSheet: {
        title: 'Filtros',
        season: 'Temporada',
        currentBadge: 'actual',
        searchEvent: 'Buscar evento',
        searchEventPlaceholder: 'ej. Brussels, Madrid, FIP Silver…',
        country: 'País',
        searchCountry: 'Buscar país…',
        noCountriesInFilter: 'No hay países en este filtro.',
        noCountryMatchSearch: 'Ningún país coincide con la búsqueda.',
        countriesCount: '{count, plural, one {# país} other {# países}}',
        region: {
          europe: 'Europa',
          latam: 'Latinoamérica',
          middleEast: 'Medio Oriente',
          asiaOceania: 'Asia / Oceanía',
          africa: 'África',
          other: 'Otros',
        },
        when: 'Cuándo',
        whenAll: 'Todas las fechas',
        whenThisMonth: 'Este mes',
        whenNext30: 'Próximos 30 días',
        whenNext90: 'Próximos 90 días',
        whenChip: {
          thisMonth: 'Este mes',
          next30: '30 días',
          next90: '90 días',
        },
        status: 'Estado',
        statusLive: 'En vivo',
        statusUpcoming: 'Próximas',
        statusCompleted: 'Completadas',
        statusFilterLabel: 'Estado',
        applyWithCount: 'Aplicar ({count, plural, one {# evento} other {# eventos}})',
      },
      spotlight: {
        dayOf: 'Día {elapsed} de {total}',
        matchesCount: '{count, plural, one {# partido} other {# partidos}}',
      },
    },
    tournament: {
      events: 'Eventos',
      bracket: {
        noDrawForCategory: 'No hay datos de cuadro para esta categoría.',
      },
    },
    matchDetail: {
      stats: {
        title: 'Estadísticas',
        noData: 'Sin datos',
        matchNotStarted: 'El partido aún no ha comenzado',
        notAvailable: 'Estadísticas no disponibles para este partido',
        comingSoon: 'Estadísticas próximamente — sincronización cada hora',
        empty: 'Sin estadísticas',
        service: 'Saque',
        return: 'Resto',
        points: 'Puntos',
      },
    },
    nav: {
      search: {
        placeholder: 'Buscar jugadores, torneos, partidos...',
        closeAria: 'Cerrar búsqueda',
        typePlayers: 'Jugadores',
        typeTournaments: 'Torneos',
        typeMatches: 'Partidos',
        categoryMen: 'Hombres',
        categoryWomen: 'Mujeres',
      },
    },
    country: {
      useMyLocation: 'Usar mi ubicación (auto)',
      searchPlaceholder: 'Buscar país…',
      searchAria: 'Buscar país',
      clearAria: 'Borrar búsqueda',
      noMatch: 'Ningún país coincide con "{query}"',
    },
  },

  // ── Portuguese (PT-BR / European Portuguese — using neutral PT) ──
  pt: {
    common: {
      close: 'Fechar',
      dismiss: 'Dispensar',
      clear: 'Limpar',
      apply: 'Aplicar',
      shareApp: 'Partilhar PadelNachos',
      changeLanguage: 'Alterar idioma',
      tbd: 'A DEFINIR',
    },
    home: {
      filtersButton: 'Filtros',
      eventsCount: '{count, plural, one {# evento} other {# eventos}}',
      tournamentTabs: {
        premier: 'Premier Padel',
        fip: 'FIP Tour',
      },
      fipTier: {
        all: 'Todos',
        platinum: 'Platinum',
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        beyond: 'Beyond',
        promises: 'Promises',
      },
      tournamentList: {
        completedYear: 'Concluídos — {year}',
        viewMatches: 'Ver jogos',
        viewEvent: 'Ver',
        daysLabel: 'DIAS',
        daysCount: '{count, plural, one {# dia} other {# dias}}',
        removeFilter: 'Remover {label}',
      },
      filterSheet: {
        title: 'Filtros',
        season: 'Temporada',
        currentBadge: 'atual',
        searchEvent: 'Procurar evento',
        searchEventPlaceholder: 'ex. Brussels, Madrid, FIP Silver…',
        country: 'País',
        searchCountry: 'Procurar país…',
        noCountriesInFilter: 'Não há países neste filtro.',
        noCountryMatchSearch: 'Nenhum país corresponde à pesquisa.',
        countriesCount: '{count, plural, one {# país} other {# países}}',
        region: {
          europe: 'Europa',
          latam: 'América Latina',
          middleEast: 'Médio Oriente',
          asiaOceania: 'Ásia / Oceânia',
          africa: 'África',
          other: 'Outros',
        },
        when: 'Quando',
        whenAll: 'Todas as datas',
        whenThisMonth: 'Este mês',
        whenNext30: 'Próximos 30 dias',
        whenNext90: 'Próximos 90 dias',
        whenChip: {
          thisMonth: 'Este mês',
          next30: '30 dias',
          next90: '90 dias',
        },
        status: 'Estado',
        statusLive: 'Ao vivo',
        statusUpcoming: 'Próximos',
        statusCompleted: 'Concluídos',
        statusFilterLabel: 'Estado',
        applyWithCount: 'Aplicar ({count, plural, one {# evento} other {# eventos}})',
      },
      spotlight: {
        dayOf: 'Dia {elapsed} de {total}',
        matchesCount: '{count, plural, one {# jogo} other {# jogos}}',
      },
    },
    tournament: {
      events: 'Eventos',
      bracket: {
        noDrawForCategory: 'Sem dados de quadro para esta categoria.',
      },
    },
    matchDetail: {
      stats: {
        title: 'Estatísticas',
        noData: 'Sem dados',
        matchNotStarted: 'O jogo ainda não começou',
        notAvailable: 'Estatísticas indisponíveis para este jogo',
        comingSoon: 'Estatísticas em breve — sincronização de hora a hora',
        empty: 'Sem estatísticas',
        service: 'Serviço',
        return: 'Devolução',
        points: 'Pontos',
      },
    },
    nav: {
      search: {
        placeholder: 'Procurar jogadores, torneios, jogos...',
        closeAria: 'Fechar pesquisa',
        typePlayers: 'Jogadores',
        typeTournaments: 'Torneios',
        typeMatches: 'Jogos',
        categoryMen: 'Homens',
        categoryWomen: 'Mulheres',
      },
    },
    country: {
      useMyLocation: 'Usar a minha localização (auto)',
      searchPlaceholder: 'Procurar país…',
      searchAria: 'Procurar país',
      clearAria: 'Limpar pesquisa',
      noMatch: 'Nenhum país corresponde a "{query}"',
    },
  },

  // ── Italian ──────────────────────────────────────────────────
  it: {
    common: {
      close: 'Chiudi',
      dismiss: 'Ignora',
      clear: 'Cancella',
      apply: 'Applica',
      shareApp: 'Condividi PadelNachos',
      changeLanguage: 'Cambia lingua',
      tbd: 'DA DEFINIRE',
    },
    home: {
      filtersButton: 'Filtri',
      eventsCount: '{count, plural, one {# evento} other {# eventi}}',
      tournamentTabs: {
        premier: 'Premier Padel',
        fip: 'FIP Tour',
      },
      fipTier: {
        all: 'Tutti',
        platinum: 'Platinum',
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        beyond: 'Beyond',
        promises: 'Promises',
      },
      tournamentList: {
        completedYear: 'Conclusi — {year}',
        viewMatches: 'Vedi partite',
        viewEvent: 'Apri',
        daysLabel: 'GIORNI',
        daysCount: '{count, plural, one {# giorno} other {# giorni}}',
        removeFilter: 'Rimuovi {label}',
      },
      filterSheet: {
        title: 'Filtri',
        season: 'Stagione',
        currentBadge: 'attuale',
        searchEvent: 'Cerca evento',
        searchEventPlaceholder: 'es. Brussels, Madrid, FIP Silver…',
        country: 'Paese',
        searchCountry: 'Cerca paese…',
        noCountriesInFilter: 'Nessun paese in questo filtro.',
        noCountryMatchSearch: 'Nessun paese corrisponde alla ricerca.',
        countriesCount: '{count, plural, one {# paese} other {# paesi}}',
        region: {
          europe: 'Europa',
          latam: 'America Latina',
          middleEast: 'Medio Oriente',
          asiaOceania: 'Asia / Oceania',
          africa: 'Africa',
          other: 'Altri',
        },
        when: 'Quando',
        whenAll: 'Tutte le date',
        whenThisMonth: 'Questo mese',
        whenNext30: 'Prossimi 30 giorni',
        whenNext90: 'Prossimi 90 giorni',
        whenChip: {
          thisMonth: 'Questo mese',
          next30: '30 giorni',
          next90: '90 giorni',
        },
        status: 'Stato',
        statusLive: 'In diretta',
        statusUpcoming: 'In arrivo',
        statusCompleted: 'Conclusi',
        statusFilterLabel: 'Stato',
        applyWithCount: 'Applica ({count, plural, one {# evento} other {# eventi}})',
      },
      spotlight: {
        dayOf: 'Giorno {elapsed} di {total}',
        matchesCount: '{count, plural, one {# partita} other {# partite}}',
      },
    },
    tournament: {
      events: 'Eventi',
      bracket: {
        noDrawForCategory: 'Nessun dato di tabellone per questa categoria.',
      },
    },
    matchDetail: {
      stats: {
        title: 'Statistiche',
        noData: 'Nessun dato',
        matchNotStarted: 'La partita non è ancora iniziata',
        notAvailable: 'Statistiche non disponibili per questa partita',
        comingSoon: 'Statistiche in arrivo — sincronizzazione ogni ora',
        empty: 'Nessuna statistica',
        service: 'Servizio',
        return: 'Risposta',
        points: 'Punti',
      },
    },
    nav: {
      search: {
        placeholder: 'Cerca giocatori, tornei, partite...',
        closeAria: 'Chiudi ricerca',
        typePlayers: 'Giocatori',
        typeTournaments: 'Tornei',
        typeMatches: 'Partite',
        categoryMen: 'Uomini',
        categoryWomen: 'Donne',
      },
    },
    country: {
      useMyLocation: 'Usa la mia posizione (auto)',
      searchPlaceholder: 'Cerca paese…',
      searchAria: 'Cerca paese',
      clearAria: 'Cancella ricerca',
      noMatch: 'Nessun paese corrisponde a "{query}"',
    },
  },

  // ── French ───────────────────────────────────────────────────
  fr: {
    common: {
      close: 'Fermer',
      dismiss: 'Ignorer',
      clear: 'Effacer',
      apply: 'Appliquer',
      shareApp: 'Partager PadelNachos',
      changeLanguage: 'Changer de langue',
      tbd: 'À DÉFINIR',
    },
    home: {
      filtersButton: 'Filtres',
      eventsCount: '{count, plural, one {# évènement} other {# évènements}}',
      tournamentTabs: {
        premier: 'Premier Padel',
        fip: 'FIP Tour',
      },
      fipTier: {
        all: 'Tous',
        platinum: 'Platinum',
        gold: 'Gold',
        silver: 'Silver',
        bronze: 'Bronze',
        beyond: 'Beyond',
        promises: 'Promises',
      },
      tournamentList: {
        completedYear: 'Terminés — {year}',
        viewMatches: 'Voir les matchs',
        viewEvent: 'Voir',
        daysLabel: 'JOURS',
        daysCount: '{count, plural, one {# jour} other {# jours}}',
        removeFilter: 'Retirer {label}',
      },
      filterSheet: {
        title: 'Filtres',
        season: 'Saison',
        currentBadge: 'actuelle',
        searchEvent: 'Rechercher un évènement',
        searchEventPlaceholder: 'ex. Brussels, Madrid, FIP Silver…',
        country: 'Pays',
        searchCountry: 'Rechercher un pays…',
        noCountriesInFilter: 'Aucun pays dans ce filtre.',
        noCountryMatchSearch: 'Aucun pays ne correspond à la recherche.',
        countriesCount: '{count, plural, one {# pays} other {# pays}}',
        region: {
          europe: 'Europe',
          latam: 'Amérique latine',
          middleEast: 'Moyen-Orient',
          asiaOceania: 'Asie / Océanie',
          africa: 'Afrique',
          other: 'Autres',
        },
        when: 'Quand',
        whenAll: 'Toutes les dates',
        whenThisMonth: 'Ce mois-ci',
        whenNext30: '30 prochains jours',
        whenNext90: '90 prochains jours',
        whenChip: {
          thisMonth: 'Ce mois-ci',
          next30: '30 jours',
          next90: '90 jours',
        },
        status: 'Statut',
        statusLive: 'En direct',
        statusUpcoming: 'À venir',
        statusCompleted: 'Terminés',
        statusFilterLabel: 'Statut',
        applyWithCount: 'Appliquer ({count, plural, one {# évènement} other {# évènements}})',
      },
      spotlight: {
        dayOf: 'Jour {elapsed} sur {total}',
        matchesCount: '{count, plural, one {# match} other {# matchs}}',
      },
    },
    tournament: {
      events: 'Évènements',
      bracket: {
        noDrawForCategory: 'Aucune donnée de tableau pour cette catégorie.',
      },
    },
    matchDetail: {
      stats: {
        title: 'Stats',
        noData: 'Aucune donnée',
        matchNotStarted: "Le match n'a pas encore commencé",
        notAvailable: 'Stats indisponibles pour ce match',
        comingSoon: 'Stats à venir — synchronisation toutes les heures',
        empty: 'Aucune statistique',
        service: 'Service',
        return: 'Retour',
        points: 'Points',
      },
    },
    nav: {
      search: {
        placeholder: 'Rechercher joueurs, tournois, matchs...',
        closeAria: 'Fermer la recherche',
        typePlayers: 'Joueurs',
        typeTournaments: 'Tournois',
        typeMatches: 'Matchs',
        categoryMen: 'Hommes',
        categoryWomen: 'Femmes',
      },
    },
    country: {
      useMyLocation: 'Utiliser ma position (auto)',
      searchPlaceholder: 'Rechercher un pays…',
      searchAria: 'Rechercher un pays',
      clearAria: 'Effacer la recherche',
      noMatch: 'Aucun pays ne correspond à "{query}"',
    },
  },
}

/** Recursively merge `src` into `dst`, overwriting leaf values. */
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
    // Pretty-print with 2-space indent and a trailing newline (matches
    // existing formatting of the JSON files).
    const out = JSON.stringify(json, null, 2) + '\n'
    await fs.writeFile(path, out, 'utf8')
    console.log(`✓ ${locale}.json updated`)
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
