import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { paginatedSelect } from '@/lib/db-paginate'
import { loadReminderMarkets, loadUserChoices } from './data'
import {
  planReminder,
  validTimezone,
  localClock,
  type ReminderMatch,
  type ReminderChannel,
} from './plan'
import {
  reminderCopy,
  reminderLocale,
  appPath,
  appBase,
  type ReminderLocale,
} from './copy'
import { hasRecentAppActivity } from './activity'
import { buildReminderEmail } from './email'

type Preference = {
  user_id: string
  email_enabled: boolean
  push_enabled: boolean
  timezone: string
  unsubscribe_token: string
}
type Payload = {
  matches: ReminderMatch[]
  locale: ReminderLocale
  timezone: string
  unsubscribeUrl: string
  email: string | null
  icon?: string | null
}
type Delivery = {
  id: string
  payload: Payload
  created_at: string
  claimed_at: string
}
export type ReminderTransport = {
  email: (payload: Payload, key: string) => Promise<string>
  push: (userId: string, payload: Payload, key: string) => Promise<boolean>
}
export async function runPlayReminders(
  db: SupabaseClient,
  transport: ReminderTransport,
  options: { dryRun: boolean; now?: number }
) {
  const now = options.now ?? Date.now(),
    stats = {
      planned: 0,
      emailSent: 0,
      pushSent: 0,
      skipped: 0,
      failed: 0,
      dryRun: options.dryRun,
    }
  const flag = await db
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'play_enabled')
    .maybeSingle()
  if (flag.error) throw Error('play_flag_unavailable')
  if (!flag.data?.enabled) return stats
  const prefs = await paginatedSelect<Preference>(
    (a, b) =>
      db
        .from('play_reminder_preferences')
        .select('*')
        .or('email_enabled.eq.true,push_enabled.eq.true')
        .order('user_id')
        .range(a, b),
    { what: 'reminder preferences' }
  )
  const marketCache = new Map<
    ReminderLocale,
    Awaited<ReturnType<typeof loadReminderMarkets>>
  >()
  // Stop after 20 actual dispatch attempts to keep this internal endpoint bounded.
  let dispatches = 0
  for (const pref of prefs) {
    if (dispatches >= 20) break
    if (!validTimezone(pref.timezone)) continue
    const clock = localClock(now, pref.timezone)
    if (
      clock.minutes < 480 ||
      clock.minutes >= 1260 ||
      (!pref.push_enabled && clock.minutes < 540)
    )
      continue
    const [access, profile, user, activity] = await Promise.all([
      db
        .from('play_access')
        .select('user_id')
        .eq('user_id', pref.user_id)
        .maybeSingle(),
      db
        .from('profiles')
        .select('locale,notification_mute_until')
        .eq('id', pref.user_id)
        .maybeSingle(),
      db.from('users').select('email').eq('id', pref.user_id).maybeSingle(),
      pref.push_enabled
        ? db
            .from('user_app_activity')
            .select('last_seen_at')
            .eq('user_id', pref.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (access.error || profile.error || user.error) {
      stats.failed++
      continue
    }
    if (!access.data || !profile.data) continue
    const muted = profile.data.notification_mute_until
    if (muted === 'forever' || (muted && Date.parse(muted) > now)) continue
    const locale = reminderLocale(profile.data.locale),
      choices = await loadUserChoices(db, pref.user_id)
    if (!marketCache.has(locale))
      marketCache.set(locale, await loadReminderMarkets(db, locale, now))
    const day = localClock(now, pref.timezone).day
    for (const channel of ['email', 'push'] as ReminderChannel[]) {
      if (
        !pref[`${channel}_enabled`] ||
        (channel === 'email' && !user.data?.email) ||
        (channel === 'push' &&
          (activity.error ||
            hasRecentAppActivity(activity.data?.last_seen_at, now)))
      )
        continue
      const matches = planReminder({
        markets: marketCache.get(locale)!,
        ...choices,
        timezone: pref.timezone,
        now,
        channel,
      })
      if (!matches.length) continue
      const prior = await db
        .from('play_reminder_deliveries')
        .select('state,channel,local_day,created_at,sent_at')
        .eq('user_id', pref.user_id)
        .eq('channel', channel)
        .gte('created_at', new Date(now - 26 * 3600000).toISOString())
      if (prior.error) {
        stats.failed++
        continue
      }
      if (
        prior.data?.some(
          (d) =>
            (d.local_day === day &&
              (d.state !== 'pending' || channel === 'push')) ||
            (d.state === 'sent' && Date.parse(d.sent_at) > now - 24 * 3600000)
        )
      )
        continue
      const payload: Payload = {
        matches,
        locale,
        icon: matches
          .flatMap((m) => [...m.pair1, ...m.pair2])
          .find((p) => choices.followed.has(p.id) && p.image)?.image,
        timezone: pref.timezone,
        email: user.data?.email ?? null,
        unsubscribeUrl: `${appBase}/api/play/reminders/unsubscribe?token=${pref.unsubscribe_token}&locale=${locale}`,
      }
      stats.planned++
      if (options.dryRun) continue
      const claim = await db.rpc('play_claim_reminder', {
        p_user: pref.user_id,
        p_channel: channel,
        p_day: day,
        p_payload: payload,
      })
      if (claim.error) {
        stats.failed++
        continue
      }
      if (!claim.data) continue
      const delivery = claim.data as Delivery
      try {
        // Refresh access, consent, previous plays and lineup immediately before dispatch.
        const fresh = await db
          .from('play_reminder_preferences')
          .select('email_enabled,push_enabled,timezone')
          .eq('user_id', pref.user_id)
          .maybeSingle()
        const member = await db
          .from('play_access')
          .select('user_id')
          .eq('user_id', pref.user_id)
          .maybeSingle()
        const currentFlag = await db
          .from('feature_flags')
          .select('enabled')
          .eq('key', 'play_enabled')
          .maybeSingle()
        const currentUser = await db
          .from('users')
          .select('email')
          .eq('id', pref.user_id)
          .maybeSingle()
        const currentProfile = await db
          .from('profiles')
          .select('notification_mute_until')
          .eq('id', pref.user_id)
          .maybeSingle()
        if (
          fresh.error ||
          member.error ||
          currentFlag.error ||
          currentProfile.error ||
          currentUser.error
        )
          throw Error('recipient_recheck_failed')
        const dispatchNow = options.now ?? Date.now(),
          freshMute = currentProfile.data?.notification_mute_until
        const originalIds = delivery.payload.matches.flatMap((m) =>
          m.markets.map((q) => q.id)
        )
        const latest = await loadReminderMarkets(
          db,
          delivery.payload.locale,
          dispatchNow,
          originalIds
        )
        const valid = planReminder({
          markets: latest,
          ...(await loadUserChoices(db, pref.user_id)),
          timezone: delivery.payload.timezone,
          channel,
          now: dispatchNow,
        })
        const latestActivity =
          channel === 'push'
            ? await db
                .from('user_app_activity')
                .select('last_seen_at')
                .eq('user_id', pref.user_id)
                .maybeSingle()
            : { data: null, error: null }
        if (latestActivity.error) throw Error('activity_recheck_failed')
        const validMatches = new Map(valid.map((m) => [m.matchId, m]))
        const scheduleChanged = delivery.payload.matches.some((m) => {
          const current = validMatches.get(m.matchId)
          return (
            !current ||
            Date.parse(current.startsAt) !== Date.parse(m.startsAt) ||
            Date.parse(current.locksAt) !== Date.parse(m.locksAt)
          )
        })
        const validIds = new Set(
          valid.flatMap((m) => m.markets.map((q) => q.id))
        )
        if (
          (channel === 'email' &&
            currentUser.data?.email !== delivery.payload.email) ||
          !fresh.data?.[`${channel}_enabled`] ||
          !member.data ||
          !currentFlag.data?.enabled ||
          fresh.data.timezone !== delivery.payload.timezone ||
          freshMute === 'forever' ||
          (freshMute && Date.parse(freshMute) > dispatchNow) ||
          (channel === 'push' &&
            hasRecentAppActivity(
              latestActivity.data?.last_seen_at,
              dispatchNow
            )) ||
          scheduleChanged ||
          originalIds.some((id) => !validIds.has(id))
        ) {
          const skipped = await db
            .from('play_reminder_deliveries')
            .update({ state: 'skipped' })
            .eq('id', delivery.id)
            .eq('claimed_at', delivery.claimed_at)
          if (skipped.error) throw Error('skip_write_failed')
          stats.skipped++
          continue
        }
        dispatches++
        const providerId =
          channel === 'email'
            ? await transport.email(
                delivery.payload,
                `padel-today-${delivery.id}`
              )
            : await transport.push(pref.user_id, delivery.payload, delivery.id)
        if (!providerId) throw Error('delivery_failed')
        const complete = await db
          .from('play_reminder_deliveries')
          .update({
            state: 'sent',
            sent_at: new Date(dispatchNow).toISOString(),
            provider_id: String(providerId),
          })
          .eq('id', delivery.id)
          .eq('claimed_at', delivery.claimed_at)
        if (complete.error) throw Error('delivery_write_failed')
        if (channel === 'email') stats.emailSent++
        else stats.pushSent++
      } catch (e) {
        stats.failed++
        console.error(
          '[play-reminders] delivery failed',
          delivery.id,
          channel,
          e instanceof Error ? e.message : 'unknown'
        )
      }
    }
  }
  return stats
}
export const productionEmail: ReminderTransport['email'] = async (
  payload,
  key
) => {
  if (!process.env.RESEND_API_KEY || !payload.email)
    throw Error('email_not_configured')
  const email = buildReminderEmail(payload)
  const r = await new Resend(process.env.RESEND_API_KEY).emails.send(
    {
      from:
        process.env.AUTH_EMAIL_FROM || 'Padel Nachos <hello@padelnachos.com>',
      to: payload.email,
      ...email,
      headers: {
        'List-Unsubscribe': `<${payload.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'campaign', value: 'padel-today' },
        { name: 'language', value: payload.locale },
      ],
    },
    { idempotencyKey: key }
  )
  if (r.error || !r.data?.id) throw Error('email_send_failed')
  // Keep below Resend's default two requests per second.
  await new Promise((resolve) => setTimeout(resolve, 600))
  return r.data.id
}
export function pushContent(payload: Payload, key: string) {
  const c = reminderCopy[payload.locale],
    first = payload.matches[0],
    count = payload.matches.reduce((n, m) => n + m.markets.length, 0)
  return {
    title: c.pushTitle,
    body:
      payload.matches.length === 1
        ? c.pushSingle
            .replace('{pair1}', first.pair1.map((p) => p.name).join(' / '))
            .replace('{pair2}', first.pair2.map((p) => p.name).join(' / '))
        : c.pushBody
            .replace('{matches}', String(payload.matches.length))
            .replace('{questions}', String(count)),
    url: appPath(payload.locale, `/play?match=${first.matchId}`),
    tag: `play-reminder-${key}`,
    icon:
      payload.icon ??
      [...first.pair1, ...first.pair2].find((p) =>
        p.image?.startsWith('https://')
      )?.image ??
      `${appBase}/padelnachos-logo-v2.png`,
  }
}
