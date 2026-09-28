import { useTranslations } from 'next-intl'

/** Only show a nudge when the destination contains actual live markets. */
export default function LiveNudge({ count }: { count: number }) {
  const t = useTranslations('play')
  if (!count) return null
  const label = `${t('live')} · ${count}`
  return <span className="pl-live-nudge" role="img" aria-label={label} title={label} />
}
