// The LAN-address rule in src/lib/play-access.ts, pinned.
//
// `isLocalRequest()` treats a private address as "local" so a phone on the
// same Wi-Fi can reach the dev server, which is NOT localhost. That rule
// decides which feature-flag column governs, so a sloppy pattern weakens the
// global kill switch.
//
// The first version was prefix-only (`/^(10\.|192\.168\.|…)/`) and matched
// `192.168.0.215.evil.com` — a hostname anyone can register. These cases
// exist so that regression cannot come back quietly.
//
// The pattern is duplicated here rather than exported: play-access.ts imports
// next/headers, which throws outside a request scope and cannot be loaded in
// a plain unit test. Keep the two in sync — the shape is asserted below.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`
const PRIVATE_IP = new RegExp(
  `^(?:10\\.${OCTET}\\.${OCTET}|127\\.${OCTET}\\.${OCTET}|192\\.168\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])\\.${OCTET})\\.${OCTET}$`,
)

describe('private LAN address detection', () => {
  it.each([
    ['192.168.0.215', true], // the dev Mac on Wi-Fi
    ['10.0.0.5', true],
    ['127.0.0.1', true],
    ['172.16.3.1', true], // low edge of 172.16/12
    ['172.31.255.1', true], // high edge of 172.16/12
  ])('treats %s as local', (host, expected) => {
    expect(PRIVATE_IP.test(host)).toBe(expected)
  })

  it.each([
    ['172.15.0.1', false], // just below the private range
    ['172.32.0.1', false], // just above it
    ['8.8.8.8', false],
    ['padelnachos.com', false],
    ['192.168.0.215.evil.com', false], // the bug the anchor fixes
    ['evil.com/192.168.0.1', false],
    ['192.168.0', false], // incomplete
    ['192.168.0.999', false], // not a valid octet
  ])('refuses %s', (host, expected) => {
    expect(PRIVATE_IP.test(host)).toBe(expected)
  })

  it('still matches the pattern shipped in play-access.ts', () => {
    const src = readFileSync(
      join(__dirname, '..', 'play-access.ts'),
      'utf8',
    )
    // Both ends anchored, and the octet helper present — the two properties
    // that make the difference between this rule and the buggy first draft.
    expect(src).toContain('const OCTET =')
    expect(src).toMatch(/PRIVATE_IP = new RegExp\(/)
    expect(src).toContain('^(?:10\\\\.')
    expect(src).toContain('\\\\.${OCTET}$')
  })

  it('is only consulted outside production', () => {
    const src = readFileSync(join(__dirname, '..', 'play-access.ts'), 'utf8')
    // The NODE_ENV guard is the reason this relaxation is safe at all.
    expect(src).toMatch(
      /process\.env\.NODE_ENV !== 'production' && PRIVATE_IP\.test/,
    )
  })
})
