// apps/labs/src/lib/conversations.ts
// CRUD helpers for labs_conversations + labs_messages. All writes go through
// the service-key Supabase client (RLS bypass) — auth is enforced by the
// caller (route handler checks Auth.js session).

import { supabaseService } from '@/lib/db'
import type { Citation } from '@/lib/data/types'

export type ConversationRow = {
  id: string
  user_id: string
  title: string | null
  locale: string
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: Citation[]
  cost_input_tokens: number
  cost_output_tokens: number
  cost_cached_tokens: number
  model: string | null
  created_at: string
}

export async function getOrCreateConversation(args: {
  userId: string
  conversationId?: string
  firstUserMessage: string
}): Promise<ConversationRow> {
  const supabase = supabaseService()

  if (args.conversationId) {
    const { data, error } = await supabase
      .from('labs_conversations')
      .select('*')
      .eq('id', args.conversationId)
      .eq('user_id', args.userId)
      .single()
    if (error) throw new Error(`getOrCreateConversation lookup: ${error.message}`)
    return data as ConversationRow
  }

  const title = args.firstUserMessage.trim().slice(0, 80) || 'New conversation'
  const { data, error } = await supabase
    .from('labs_conversations')
    .insert({ user_id: args.userId, title, locale: 'en' })
    .select('*')
    .single()
  if (error) throw new Error(`getOrCreateConversation insert: ${error.message}`)
  return data as ConversationRow
}

export async function appendMessage(args: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  cost?: { input_tokens: number; output_tokens: number; cache_read_tokens: number }
  model?: string
}): Promise<MessageRow> {
  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('labs_messages')
    .insert({
      conversation_id: args.conversationId,
      role: args.role,
      content: args.content,
      citations: args.citations ?? [],
      cost_input_tokens: args.cost?.input_tokens ?? 0,
      cost_output_tokens: args.cost?.output_tokens ?? 0,
      cost_cached_tokens: args.cost?.cache_read_tokens ?? 0,
      model: args.model ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(`appendMessage: ${error.message}`)

  // Touch conversation updated_at (trigger handles the timestamp).
  await supabase
    .from('labs_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)

  return data as MessageRow
}

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('labs_conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`listConversations: ${error.message}`)
  return (data ?? []) as ConversationRow[]
}

export async function loadConversationWithMessages(args: {
  userId: string
  conversationId: string
}): Promise<{ conversation: ConversationRow; messages: MessageRow[] } | null> {
  const supabase = supabaseService()
  const { data: conv, error: convErr } = await supabase
    .from('labs_conversations')
    .select('*')
    .eq('id', args.conversationId)
    .eq('user_id', args.userId)
    .maybeSingle()
  if (convErr) throw new Error(`loadConversation: ${convErr.message}`)
  if (!conv) return null

  const { data: msgs, error: msgsErr } = await supabase
    .from('labs_messages')
    .select('*')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: true })
  if (msgsErr) throw new Error(`loadMessages: ${msgsErr.message}`)

  return {
    conversation: conv as ConversationRow,
    messages: (msgs ?? []) as MessageRow[],
  }
}
