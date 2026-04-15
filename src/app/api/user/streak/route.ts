import { getUserOrFail } from '../_auth'

export async function POST() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data: profile } = await supabase!
    .from('profiles')
    .select('last_active_at, login_streak, longest_streak')
    .eq('id', user!.id)
    .single()

  if (!profile) return Response.json({ error: 'profile not found' }, { status: 404 })

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const lastActive = profile.last_active_at
    ? new Date(profile.last_active_at).toISOString().slice(0, 10)
    : null

  if (lastActive === today) {
    return Response.json({ streak: profile.login_streak, longest: profile.longest_streak, already_updated: true })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const newStreak = lastActive === yesterdayStr
    ? (profile.login_streak ?? 0) + 1
    : 1
  const newLongest = Math.max(newStreak, profile.longest_streak ?? 0)

  await supabase!
    .from('profiles')
    .update({ last_active_at: now.toISOString(), login_streak: newStreak, longest_streak: newLongest })
    .eq('id', user!.id)

  return Response.json({ streak: newStreak, longest: newLongest })
}
