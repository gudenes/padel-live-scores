import { it, expect } from 'vitest'
import { hasSameLocalOrigin } from '../local-request-origin'
const request = (origin: string, host='127.0.0.1:3014') => new Request('http://localhost:3014/api/settings', {headers:{origin,host}})
it('accepts the original loopback Host when Next normalizes the URL', () => {
 expect(hasSameLocalOrigin(request('http://127.0.0.1:3014'))).toBe(true)
 expect(hasSameLocalOrigin(request('http://localhost:3014','localhost:3014'))).toBe(true)
})
it('rejects different origins, ports, protocols, malformed hosts and missing origins', () => {
 for(const origin of ['http://localhost:3014','http://127.0.0.1:3012','https://127.0.0.1:3014','null','http://evil.test','http://127.0.0.1:3014/path']) expect(hasSameLocalOrigin(request(origin))).toBe(false)
 expect(hasSameLocalOrigin(request('http://evil.test','evil.test'))).toBe(false)
 expect(hasSameLocalOrigin(request('http://127.0.0.1:3014','user@127.0.0.1:3014'))).toBe(false)
 expect(hasSameLocalOrigin(new Request('http://localhost:3014'))).toBe(false)
})
