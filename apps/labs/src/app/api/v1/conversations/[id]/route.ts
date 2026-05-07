// GET /api/v1/conversations/[id] — return one conversation + its full message history.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { loadConversationWithMessages } from '@/lib/conversations'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const loaded = await loadConversationWithMessages({
    userId: session.user.id,
    conversationId: id,
  })
  if (!loaded) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json(loaded)
}
