// src/lib/activity-log.ts
// Fire-and-forget event logger via API route.

export async function logActivity(
  _userId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await fetch('/api/user/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target_id: targetId, metadata }),
    })
  } catch {
    // Silent — never block UI for logging
  }
}
