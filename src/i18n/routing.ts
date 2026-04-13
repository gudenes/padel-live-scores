// src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'es', 'pt', 'it'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
})
