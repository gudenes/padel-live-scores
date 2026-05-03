/**
 * delete-plan.test.ts
 *
 * Unit tests for the pure account-delete SQL plan generator.
 * Run with: npx vitest run src/lib/__tests__/delete-plan.test.ts
 */

import { describe, it, expect } from 'vitest'
import { buildDeletePlan } from '../delete-plan'

const USER_ID = '11111111-1111-1111-1111-111111111111'

describe('buildDeletePlan', () => {
  it('returns 14 ordered statements', () => {
    const plan = buildDeletePlan(USER_ID)
    expect(plan).toHaveLength(14)
  })

  it('first statement nulls referred_by on anyone this user invited', () => {
    const plan = buildDeletePlan(USER_ID)
    expect(plan[0].sql).toMatch(/UPDATE\s+profiles/i)
    expect(plan[0].sql).toMatch(/SET\s+referred_by\s*=\s*NULL/i)
    expect(plan[0].sql).toMatch(/WHERE\s+referred_by\s*=\s*\$1/i)
    expect(plan[0].params).toEqual([USER_ID])
  })

  it('referred_by nulling precedes the profiles delete', () => {
    const plan = buildDeletePlan(USER_ID)
    const nullIdx = plan.findIndex(p => /SET\s+referred_by\s*=\s*NULL/i.test(p.sql))
    const profilesDeleteIdx = plan.findIndex(p =>
      /DELETE FROM\s+profiles/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
    )
    expect(nullIdx).toBeGreaterThanOrEqual(0)
    expect(profilesDeleteIdx).toBeGreaterThan(nullIdx)
  })

  it('deletes user-scoped child rows before profiles row', () => {
    const plan = buildDeletePlan(USER_ID)
    const profilesIdx = plan.findIndex(p =>
      /DELETE FROM\s+profiles/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
    )
    const childTables = [
      'user_badges',
      'user_bookmarks',
      'push_subscriptions',
      'native_push_subscriptions',
      'user_notifications',
      'match_ratings',
      'feature_interest',
      'user_activity_log',
      'racket_clicks',
    ]
    for (const t of childTables) {
      const idx = plan.findIndex(p => new RegExp(`DELETE FROM\\s+${t}`, 'i').test(p.sql))
      expect(idx, `${t} delete must exist`).toBeGreaterThanOrEqual(0)
      expect(idx, `${t} must be deleted before profiles`).toBeLessThan(profilesIdx)
    }
  })

  it('deletes Auth.js sessions and accounts before users', () => {
    const plan = buildDeletePlan(USER_ID)
    const sessionsIdx = plan.findIndex(p => /DELETE FROM\s+sessions/i.test(p.sql))
    const accountsIdx = plan.findIndex(p => /DELETE FROM\s+accounts/i.test(p.sql))
    const usersIdx = plan.findIndex(p =>
      /DELETE FROM\s+users/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
    )
    expect(sessionsIdx).toBeGreaterThanOrEqual(0)
    expect(accountsIdx).toBeGreaterThanOrEqual(0)
    expect(usersIdx).toBeGreaterThanOrEqual(0)
    expect(sessionsIdx).toBeLessThan(usersIdx)
    expect(accountsIdx).toBeLessThan(usersIdx)
  })

  it('every statement uses $1 parameterization bound to the user id', () => {
    const plan = buildDeletePlan(USER_ID)
    for (const stmt of plan) {
      expect(stmt.sql).toContain('$1')
      expect(stmt.params).toEqual([USER_ID])
    }
  })

  it('last statement deletes the Auth.js users row', () => {
    const plan = buildDeletePlan(USER_ID)
    const last = plan[plan.length - 1]
    expect(last.sql).toMatch(/DELETE FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i)
  })
})
