import { describe, expect, it } from 'vitest'
import { budgetSignal, feedHealth, monitorSnapshot } from '../integration-monitor'
const now = Date.parse('2026-11-20T14:00:00Z')
const payload = { data: { status: 'ok', uptime_seconds: 300, proxy_routes: { fixed_1: { requests: 10, failures: 1, bytes: 1000 }, residential: { requests: 1, failures: 0, bytes: 10 } }, proxy_routing: { policy: { residential_configured: true, residential_daily_byte_limit: 100 }, routes: { fixed_1: { lastAttemptAt: '2026-11-20T13:59:00Z', lastSuccessAt: '2026-11-20T13:59:00Z', lastFailed: false }, residential: { lastAttemptAt: '2026-11-20T13:59:00Z', lastFailed: true } } }, residential_usage: { utc_day: '2026-11-20', estimated_body_bytes: 85 }, proxy_bandwidth: { event_page: { requests: 10, bytes: 1000 } } } }
describe('integration monitor', () => {
  it('does not turn missing telemetry into zero usage or healthy proxy status', () => {
    const result = monitorSnapshot({ data: { status: 'ok', uptime_seconds: 300 } }, [], now)
    expect(result.runtime.status).toBe('healthy')
    expect(result.runtime.telemetryAvailable).toBe(false)
    expect(result.budget).toBeNull()
    expect(result.routes).toEqual([])
  })
  it('uses the last route result, not lifetime failure counts, for its light', () => {
    const result = monitorSnapshot(payload, [], now)
    expect(result.routes[0].status).toBe('healthy')
    expect(result.routes[1].status).toBe('error')
    expect(result.budget?.status).toBe('warning')
  })
  it('marks stale route observations unknown and rejects yesterday’s budget', () => {
    const result = monitorSnapshot(payload, [], now + 86_400_000)
    expect(result.routes.every(route => route.status === 'unknown')).toBe(true)
    expect(result.budget).toBeNull()
  })
  it('does not forward secrets, arbitrary keys or upstream errors', () => {
    const result = monitorSnapshot({ ...payload, password: 'SECRET', data: { ...payload.data, error: 'SECRET', proxy_routes: { ...payload.data.proxy_routes, 'http://user:SECRET@host': { bytes: 20 } } } }, [], now)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
  it('handles disabled budgets and warning/exhaustion thresholds', () => {
    expect(budgetSignal(0,0)).toBe('unknown')
    expect(budgetSignal(79,100)).toBe('healthy')
    expect(budgetSignal(80,100)).toBe('warning')
    expect(budgetSignal(100,100)).toBe('error')
  })
  it('makes unavailable and idle ingestion unknown, failures red, mixed failures amber', () => {
    expect(feedHealth('fip','FIP',null,null,null,false,now).status).toBe('unknown')
    expect(feedHealth('fip','FIP',0,0,null,false,now).status).toBe('unknown')
    expect(feedHealth('fip','FIP',10,10,'2026-11-20T13:59:00Z',true,now).status).toBe('error')
    expect(feedHealth('fip','FIP',100,6,'2026-11-20T13:59:00Z',false,now).status).toBe('warning')
  })
})
