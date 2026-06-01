// apps/ops/src/app/(app)/news-sources/TranslationChips.tsx
// 4 small locale chips showing translation coverage for an article.
// Each chip is filled (brand color) when BOTH title and summary
// translations exist for that locale, outlined / muted otherwise.

const LOCALES = ['es', 'pt', 'it', 'fr'] as const

interface Props {
  title_translations: Record<string, string> | null
  summary_translations: Record<string, string> | null
}

export function TranslationChips({ title_translations, summary_translations }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {LOCALES.map(loc => {
        const hasTitle = !!title_translations?.[loc]
        const hasSummary = !!summary_translations?.[loc]
        const complete = hasTitle && hasSummary
        const titleText = complete
          ? `${loc.toUpperCase()}: complete`
          : `${loc.toUpperCase()}: missing ${[
              !hasTitle && 'title',
              !hasSummary && 'summary',
            ].filter(Boolean).join(' + ')}`
        return (
          <span
            key={loc}
            title={titleText}
            style={{
              display: 'inline-block',
              padding: '2px 6px',
              fontSize: 9, fontWeight: 800,
              letterSpacing: '0.05em',
              borderRadius: 'var(--r-xs)',
              background: complete ? 'var(--lime)' : 'transparent',
              color: complete ? 'var(--lime-ink)' : 'var(--text-3)',
              border: complete ? 'none' : '1px solid var(--border-card)',
            }}
          >
            {loc.toUpperCase()}
          </span>
        )
      })}
    </div>
  )
}
