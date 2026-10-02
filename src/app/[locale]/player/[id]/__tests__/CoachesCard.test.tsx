// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { CoachesCard } from '../CoachesCard'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import it_ from '@/messages/it.json'
import fr from '@/messages/fr.json'

afterEach(cleanup)

const locales = { en, es, pt, it: it_, fr } as Record<string, Record<string, unknown>>
const renderCard = (coaches: { coach_id: string; display_name: string }[], locale = 'en') =>
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
  renderCard([{ coach_id: 'c1', display_name: 'Jorge Martinez' }])
  expect(screen.getByText('Coach')).toBeTruthy()
  expect(screen.getByText('Jorge Martinez')).toBeTruthy()
})

it('uses the plural label and keeps FIP order for two coaches', () => {
  renderCard([
    { coach_id: 'c1', display_name: 'Gustavo Pratto' },
    { coach_id: 'c2', display_name: 'Martin Canali' },
  ])
  expect(screen.getByText('Coaches')).toBeTruthy()
  const names = screen.getAllByTestId('coach-name').map((n) => n.textContent)
  expect(names).toEqual(['Gustavo Pratto', 'Martin Canali'])
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
    const one1 = renderCard([{ coach_id: 'c1', display_name: 'A B' }], loc)
    expect(screen.getByText(one)).toBeTruthy()
    one1.unmount()
    renderCard([{ coach_id: 'c1', display_name: 'A B' }, { coach_id: 'c2', display_name: 'C D' }], loc)
    expect(screen.getByText(many)).toBeTruthy()
  })
}
