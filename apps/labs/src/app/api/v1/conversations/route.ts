// GET /api/v1/conversations — list current user's conversations (most recent first).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listConversations } from '@/lib/conversations'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const conversations = await listConversations(session.user.id)
  return NextResponse.json({ conversations })
}
