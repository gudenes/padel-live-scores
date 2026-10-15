import { expect, it } from 'vitest'
import { reminderCopy } from '../copy'
import { pushContent } from '../run'
import { routing } from '@/i18n/routing'

it('uses the approved target-emoji wording in every supported language with a Predict link', () => {
  expect(Object.keys(reminderCopy).sort()).toEqual([...routing.locales].sort())
  expect(reminderCopy.en.pushTitle).toBe(
    '🎯 Padel Predict: New markets are open!'
  )
  expect(reminderCopy.en.pushBody).toBe(
    'Have you made your predictions yet? Make your picks and climb the leaderboard!'
  )
  for (const locale of routing.locales) {
    const content = pushContent(
      {
        matches: [],
        locale,
        timezone: 'Europe/Madrid',
        email: null,
        unsubscribeUrl: '',
      },
      'id'
    )
    expect(content.title).toContain('🎯')
    expect(content.title + content.body).not.toMatch(/[—–{}]/)
    expect(content.url).toBe(locale === 'en' ? '/play' : `/${locale}/play`)
  }
})
