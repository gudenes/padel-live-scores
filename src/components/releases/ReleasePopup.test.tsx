// @vitest-environment jsdom
import React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import es from '@/messages/es.json'
import en from '@/messages/en.json'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('next/image', () => ({ default: ({ fill, priority, ...props }: Record<string, unknown>) => { void fill; void priority; return React.createElement('img', props) } }))
vi.mock('@/components/PressButton', () => ({ PRESS_PRESETS: { chunkyTilted: {}, chunkyInline: {} }, default: ({ as, ...props }: Record<string, unknown>) => React.createElement((as as string) || 'button', props) }))
vi.mock('@/i18n/navigation', () => ({ getPathname: ({ locale, href }: { locale: string; href: string }) => locale === 'en' ? href : `/${locale}${href}` }))
import ReleasePopup from './ReleasePopup'
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  HTMLElement.prototype.scrollTo = vi.fn()
})
afterEach(cleanup)
it('preserves the locale on both CTAs and closes on CTA activation', () => {
  const close = vi.fn(); const shown = vi.fn()
  render(<NextIntlClientProvider locale="es" messages={es}><ReleasePopup open locale="es" onClose={close} onShown={shown} /></NextIntlClientProvider>)
  expect(shown).toHaveBeenCalledOnce()
  expect(screen.getByText('Momo Gonzalez')).toBeTruthy()
  expect(screen.getByText('Gonzalo Alfonso')).toBeTruthy()
  expect(screen.getByText('Lucas Campagnolo')).toBeTruthy()
  expect(screen.getByRole('link').getAttribute('href')).toBe('/es/rankings?type=race')
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente: Puntos por partido' }))
  expect(screen.getByRole('link').getAttribute('href')).toBe('/es/matches')
  expect(screen.getByText('Q2')).toBeTruthy()
  expect(screen.getByText('Fin del torneo')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cerrar novedades' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link'))
  expect(close).toHaveBeenCalledOnce()
})
it('restores body scrolling and focus when unmounted and handles Escape cancellation', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  document.body.style.overflow = 'auto'
  const close = vi.fn()
  const view = render(<NextIntlClientProvider locale="en" messages={en}><ReleasePopup open onClose={close} /></NextIntlClientProvider>)
  expect(document.body.style.overflow).toBe('hidden')
  act(() => { document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })) })
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  expect(document.body.style.overflow).toBe('auto')
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
