// src/types/road-to-olympics.ts
//
// Type definitions for the Road to the Olympics hub.
// Counter state and supporting JSON blobs live in src/data/road-to-olympics/.
// Tracker state migrates to the road_to_olympics_state DB table in the
// Hardening Wave; until then, JSON is the source of truth.

export type CriteriaStatus = 'done' | 'on-track' | 'building'

export interface RoadToOlympicsState {
  /** ISO 8601 timestamp of the next IOC milestone (Brisbane 2032 decision). */
  iocSessionAt: string
  /** Override for the countdown label (e.g. "Decision postponed"). */
  countdownLabel: string | null
  /** Counter values driving the scorecard. */
  counters: {
    federationsCount: number
    federationsSourceUrl: string
    continentsCount: number
    continentsSourceUrl: string
    genderPctFemale: number
    genderSourceUrl: string
    eliteCountriesCount: number
    eliteStatusLabel: string  // e.g. "Building"
    eliteSourceUrl: string
    compliance: {
      charter: boolean
      wada: boolean
      manipulation: boolean
      sourceUrl: string
    }
  }
  /** When the values above were last reviewed. */
  lastUpdatedAt: string
}

export interface CriteriaRow {
  /** Stable key for the row. */
  key: string
  /** Display label, e.g. "Compliance (Charter, WADA)". */
  label: string
  /** One-line description for tooltip / accessibility. */
  description: string
  /**
   * Function-name reference describing how to derive the pill from state.
   * The hub page maps each `key` to a derivation in src/lib/road-to-olympics/state.ts.
   * Engineers don't need to read this field — it's documentation.
   */
  derivation: string
}

export interface DecisionMaker {
  key: string
  /** Which side of the Olympic equation this person represents. */
  group: 'olympic-committee' | 'padel-advocates'
  role: string                 // "FIP President"
  name: string                 // "Luigi Carraro"
  org: string                  // "Int'l Padel Federation"
  country: string | null       // ISO-2, optional
  /** Public path under /public/road-to-olympics/decision-makers/. NULL renders initials. */
  photoPath: string | null
  blurb: string                // one-line bio
  lastQuote: string | null
  lastQuoteUrl: string | null
}

export interface PledgeRow {
  id: string
  user_id: string | null
  email: string | null
  display_name: string | null
  country: string | null
  subscribed: boolean
  source: string | null
  ip_hash: string | null
  created_at: string
}

export interface SubscriberRow {
  id: string
  email: string
  user_id: string | null
  locale: 'en' | 'es' | 'pt' | 'it' | 'fr'
  confirm_token: string | null
  confirmed_at: string | null
  unsubscribed_at: string | null
  created_at: string
}
