import { it, expect, vi, afterEach } from 'vitest'
import { startForegroundPresence } from '../foreground-presence'
function setup(native = false) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
  const d = new EventTarget(),
    w = new EventTarget()
  const doc = Object.assign(d, { hidden: false, hasFocus: (): boolean => true })
  const ping = vi.fn().mockResolvedValue(undefined)
  const presence = startForegroundPresence({
    document: doc,
    window: w,
    ping,
    native,
  })
  return { doc, w, ping, presence }
}
afterEach(() => vi.useRealTimers())
it('records foreground opens, throttles focus events, and cleans up on sign out', async () => {
  const s = setup()
  await vi.advanceTimersByTimeAsync(0)
  expect(s.ping).toHaveBeenCalledTimes(1)
  s.w.dispatchEvent(new Event('focus'))
  expect(s.ping).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60000)
  expect(s.ping).toHaveBeenCalledTimes(2)
  s.presence.stop()
  await vi.advanceTimersByTimeAsync(60000)
  expect(s.ping).toHaveBeenCalledTimes(2)
})
it('ignores hidden browser tabs and resumes when visible', async () => {
  const s = setup()
  await vi.advanceTimersByTimeAsync(0)
  s.doc.hidden = true
  await vi.advanceTimersByTimeAsync(120000)
  expect(s.ping).toHaveBeenCalledTimes(1)
  s.doc.hidden = false
  s.doc.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(s.ping).toHaveBeenCalledTimes(2)
  s.presence.stop()
})
it('does not treat an unfocused desktop window as activity', async () => {
  const s = setup()
  await vi.advanceTimersByTimeAsync(0)
  s.doc.hasFocus = () => false
  await vi.advanceTimersByTimeAsync(120000)
  expect(s.ping).toHaveBeenCalledTimes(1)
  s.presence.stop()
})
it('native apps wait for confirmed foreground state and stop in background', async () => {
  const s = setup(true)
  expect(s.ping).not.toHaveBeenCalled()
  s.presence.setNativeActive(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(s.ping).toHaveBeenCalledTimes(1)
  s.presence.setNativeActive(false)
  await vi.advanceTimersByTimeAsync(120000)
  expect(s.ping).toHaveBeenCalledTimes(1)
  s.presence.setNativeActive(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(s.ping).toHaveBeenCalledTimes(2)
  s.presence.stop()
})
