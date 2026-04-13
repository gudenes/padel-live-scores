// src/lib/format-patterns.ts
// Centralized date/time format options for use with next-intl's format.dateTime().
// All calls inherit the user's timezone from the global next-intl config.

export const TIME_24H = { hour: '2-digit', minute: '2-digit', hour12: false } as const
export const DATE_SHORT = { day: 'numeric', month: 'short' } as const
export const DATE_WITH_WEEKDAY = { weekday: 'short', day: 'numeric', month: 'short' } as const
export const DATE_WITH_YEAR = { day: 'numeric', month: 'short', year: 'numeric' } as const
export const MONTH_YEAR = { month: 'short', year: 'numeric' } as const
export const WEEKDAY_SHORT = { weekday: 'short' } as const
export const DATE_RANGE = { day: 'numeric', month: 'short' } as const
