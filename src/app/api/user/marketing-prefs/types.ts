// src/app/api/user/marketing-prefs/types.ts

export type MarketingPrefsRequest = { optIn: boolean }

export type MarketingPrefsResponse =
  | { ok: true; marketing_opt_in: boolean }
  | { error: string }
