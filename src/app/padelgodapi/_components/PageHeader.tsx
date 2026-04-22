// src/app/padelgodapi/_components/PageHeader.tsx
// Top-of-page H1 + eyebrow category + lead paragraph.

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="mb-10 border-b border-[var(--border-base)] pb-6">
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          {eyebrow}
        </p>
      )}
      <h1 className="mb-3 font-display text-4xl font-bold tracking-tight text-[var(--text-primary)] md:text-5xl">
        {title}
      </h1>
      {description && (
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
      )}
    </header>
  )
}
