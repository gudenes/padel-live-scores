import { playerRoundCode } from './player-display'

/** Normalize provider data before selecting a known translation key. */
export function competitionRoundLabel(value: string | null | undefined, t: (key: string) => string): string {
  if (!value) return ''
  const code = playerRoundCode(value)
  return code ? t(`rounds.${code}`) : t('unknown')
}

/** Translate the generic court prefix while preserving the venue/sponsor name. */
export function competitionCourtLabel(value: string | null | undefined, t: (key: string) => string): string {
  return (value ?? '').replace(/^court\b/i, t('court'))
}

export function localizedRegionName(code: string, locale: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code.toUpperCase()) ?? code
}
