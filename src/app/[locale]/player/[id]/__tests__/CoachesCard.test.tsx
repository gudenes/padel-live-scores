// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { CoachesCard } from '../CoachesCard'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import it_ from '@/messages/it.json'
import fr from '@/messages/fr.json'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

afterEach(cleanup)

const locales = { en, es, pt, it: it_, fr } as Record<string, Record<string, unknown>>
const renderCard = (coaches: { coach_id: string; display_name: string; slug: string }[], locale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      <CoachesCard coaches={coaches} />
    </NextIntlClientProvider>,
  )

it('renders nothing without coaches', () => {
  const { container } = renderCard([])
  expect(container.textContent).toBe('')
})

it('uses the singular label for one coach', () => {
  renderCard([{ coach_id: 'c1', display_name: 'Jorge Martinez', slug: 'jorge-martinez' }])
  expect(screen.getByText('Coach')).toBeTruthy()
  expect(screen.getByText('Jorge Martinez')).toBeTruthy()
})

it('uses the plural label and keeps FIP order for two coaches', () => {
  renderCard([
    { coach_id: 'c1', display_name: 'Gustavo Pratto', slug: 'gustavo-pratto' },
    { coach_id: 'c2', display_name: 'Martin Canali', slug: 'martin-canali' },
  ])
  expect(screen.getByText('Coaches')).toBeTruthy()
  const names = screen.getAllByTestId('coach-name').map((n) => n.textContent)
  expect(names).toEqual(['Gustavo Pratto', 'Martin Canali'])
  expect(screen.getAllByTestId('coach-name')[0].closest('a')!.getAttribute('href')).toMatch(/\/coach\/gustavo-pratto$/)
  expect(screen.getAllByTestId('coach-name')[0].closest('div')!.textContent).toBe('Gustavo Pratto, Martin Canali')
})

const labels: Record<string, [string, string]> = {
  en: ['Coach', 'Coaches'],
  es: ['Entrenador', 'Entrenadores'],
  pt: ['Treinador', 'Treinadores'],
  it: ['Allenatore', 'Allenatori'],
  fr: ['Entraîneur', 'Entraîneurs'],
}
for (const [loc, [one, many]] of Object.entries(labels)) {
  it(`renders real ${loc} labels for 1 and 2 coaches`, () => {
    const one1 = renderCard([{ coach_id: 'c1', display_name: 'A B', slug: 'a-b' }], loc)
    expect(screen.getByText(one)).toBeTruthy()
    one1.unmount()
    renderCard([{ coach_id: 'c1', display_name: 'A B', slug: 'a-b' }, { coach_id: 'c2', display_name: 'C D', slug: 'c-d' }], loc)
    expect(screen.getByText(many)).toBeTruthy()
  })
}
