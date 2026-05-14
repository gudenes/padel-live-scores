import { describe, expect, it } from 'vitest'
import { parseYoutubeChannelInput } from '../youtube-channel-input'

describe('parseYoutubeChannelInput', () => {
  it('returns kind=id for raw channel IDs', () => {
    expect(parseYoutubeChannelInput('UCo2fCPOJnS95_PNOta5Jafg')).toEqual({
      kind: 'id', value: 'UCo2fCPOJnS95_PNOta5Jafg',
    })
  })

  it('returns kind=handle for @handle input (with or without @)', () => {
    expect(parseYoutubeChannelInput('@padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
    expect(parseYoutubeChannelInput('padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
  })

  it('extracts handle from youtube.com/@handle URL', () => {
    expect(parseYoutubeChannelInput('https://youtube.com/@padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
    expect(parseYoutubeChannelInput('https://www.youtube.com/@PremierPadelOfficial')).toEqual({
      kind: 'handle', value: 'PremierPadelOfficial',
    })
  })

  it('extracts channel ID from /channel/ URL', () => {
    expect(parseYoutubeChannelInput('https://www.youtube.com/channel/UCo2fCPOJnS95_PNOta5Jafg')).toEqual({
      kind: 'id', value: 'UCo2fCPOJnS95_PNOta5Jafg',
    })
  })

  it('treats /c/slug URLs as a handle (legacy vanity)', () => {
    expect(parseYoutubeChannelInput('https://www.youtube.com/c/PremierPadel')).toEqual({
      kind: 'handle', value: 'PremierPadel',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseYoutubeChannelInput('  @padelfip  ')).toEqual({ kind: 'handle', value: 'padelfip' })
  })

  it('returns null for empty / unparseable input', () => {
    expect(parseYoutubeChannelInput('')).toBeNull()
    expect(parseYoutubeChannelInput('   ')).toBeNull()
    expect(parseYoutubeChannelInput('https://example.com/foo')).toBeNull()
  })
})
