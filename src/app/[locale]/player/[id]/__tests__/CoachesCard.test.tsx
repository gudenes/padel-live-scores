// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { CoachesCard } from '../CoachesCard'

afterEach(cleanup)

const messages = { player: { coachesLabel: '{count, plural, one {Coach} other {Coaches}}' } }
const renderCard = (coaches: { coach_id: string; display_name: string }[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
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
