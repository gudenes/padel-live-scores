/**
 * Use for inline font sizes on public input, textarea and select controls.
 * Keeps the desktop size, with a touch-device floor defined in globals.css to
 * avoid iOS focus zoom. CSS-only controls should likewise use at least 16px on
 * touch devices. Do not use for labels, buttons, checkboxes or surrounding text.
 */
export function mobileInputFontSize(desktopPx: number): string {
  return `max(${desktopPx}px, var(--input-font-size-min, 16px))`
}
