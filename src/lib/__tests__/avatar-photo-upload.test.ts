// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { prepareAvatarPhoto, uploadAvatarPhoto } from '../avatar-photo-upload'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('resizes a landscape phone photo before upload and releases the object URL', async () => {
  const revoke = vi.fn(), draw = vi.fn()
  vi.stubGlobal('Image', class {
    naturalWidth = 4000; naturalHeight = 3000
    onload: (() => void) | null = null
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:photo', revokeObjectURL: revoke })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({fillRect:vi.fn(),drawImage:draw} as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb, type) {
    expect(this.width).toBe(1024); expect(this.height).toBe(768)
    expect(type).toBe('image/jpeg')
    cb(new Blob(['jpeg'],{type:'image/jpeg'}))
  })
  const photo=await prepareAvatarPhoto(new File(['source'],'large.png'),new AbortController().signal)
  expect(photo.type).toBe('image/jpeg')
  expect(draw).toHaveBeenCalled()
  expect(revoke).toHaveBeenCalledWith('blob:photo')
})
it.each([[413,'photo_too_large'],[524,'upload_timeout'],[504,'upload_timeout'],[403,'upload_session'],[502,'upload_connection']])('handles a non-JSON HTTP %s response',async (status,code)=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('<html>Error</html>',{status:Number(status)}))
  await expect(uploadAvatarPhoto(new Blob(),new AbortController().signal,fetcher)).rejects.toThrow(String(code))
})
it('distinguishes connection failures from JSON provider errors',async ()=>{
  const fetcher=vi.fn().mockRejectedValue(new TypeError('network'))
  await expect(uploadAvatarPhoto(new Blob(),new AbortController().signal,fetcher)).rejects.toThrow('upload_connection')
  fetcher.mockResolvedValue(Response.json({error:'provider_busy'},{status:429}))
  await expect(uploadAvatarPhoto(new Blob(),new AbortController().signal,fetcher)).rejects.toThrow('provider_busy')
})
it('returns the generated outfit on success',async ()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({outfit:'custom:test'}))
  expect(await uploadAvatarPhoto(new Blob(),new AbortController().signal,fetcher)).toBe('custom:test')
})
