// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AvatarCamera from '../AvatarCamera'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
const stop = vi.fn()
const stream = { getTracks: () => [{ stop }] }
const getUserMedia = vi.fn()
beforeEach(() => {
  vi.stubGlobal('React', React)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  getUserMedia.mockResolvedValue(stream)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('requests only the front camera and releases it on unmount', async () => {
  const view = render(<AvatarCamera onPhoto={vi.fn()} onClose={vi.fn()} />)
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } } })
  view.unmount()
  expect(stop).toHaveBeenCalled()
})
it('explains denied permission and keeps capture disabled', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
  render(<AvatarCamera onPhoto={vi.fn()} onClose={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'cameraDenied')
  expect(screen.getByRole('button', { name: 'cameraCapture' })).toHaveProperty('disabled', true)
})
it('stops a stream whose permission resolves after closing', async () => {
  let resolve!: (value: typeof stream) => void
  getUserMedia.mockReturnValue(new Promise(r => { resolve = r }))
  const view = render(<AvatarCamera onPhoto={vi.fn()} onClose={vi.fn()} />)
  view.unmount()
  await act(async () => resolve(stream))
  expect(stop).toHaveBeenCalled()
})
it('stops when its containing dialog closes', async () => {
  const onClose = vi.fn()
  render(<dialog open><AvatarCamera onPhoto={vi.fn()} onClose={onClose} /></dialog>)
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  fireEvent(screen.getByRole('dialog'), new Event('close'))
  expect(stop).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})
it('captures a resized JPEG for preview without uploading it', async () => {
  const onPhoto = vi.fn(), onClose = vi.fn(), drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    expect(this.width).toBe(1024); expect(this.height).toBe(768)
    callback(new Blob(['photo'], { type: 'image/jpeg' }))
  })
  render(<AvatarCamera onPhoto={onPhoto} onClose={onClose} />)
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  const video = screen.getByLabelText('cameraPreview', { selector: 'video' })
  Object.defineProperties(video, { videoWidth: { value: 2048 }, videoHeight: { value: 1536 } })
  fireEvent.loadedData(video)
  fireEvent.click(screen.getByRole('button', { name: 'cameraCapture' }))
  expect(onPhoto.mock.calls[0][0]).toBeInstanceOf(File)
  expect(onPhoto.mock.calls[0][0].type).toBe('image/jpeg')
  expect(onClose).toHaveBeenCalled()
})

it('ends the waiting state and stops a stream granted after the timeout', async () => {
  vi.useFakeTimers()
  try {
    let resolve!: (value: typeof stream) => void
    getUserMedia.mockReturnValue(new Promise(r => { resolve = r }))
    render(<AvatarCamera onPhoto={vi.fn()} onClose={vi.fn()} />)
    await act(async () => { vi.advanceTimersByTime(15000) })
    expect(screen.getByRole('alert').textContent).toBe('cameraTimeout')
    await act(async () => resolve(stream))
    expect(stop).toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('does not time out after video frames arrive', async () => {
  vi.useFakeTimers()
  try {
    render(<AvatarCamera onPhoto={vi.fn()} onClose={vi.fn()} />)
    await act(async () => {})
    fireEvent.loadedData(screen.getByLabelText('cameraPreview', { selector: 'video' }))
    await act(async () => { vi.advanceTimersByTime(15000) })
    expect(screen.queryByRole('alert')).toBeNull()
  } finally { vi.useRealTimers() }
})
