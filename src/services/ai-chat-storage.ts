// Cloud sync for W.A.V.E. AI assistant research chats.
// Keyed by Clerk user id (stored as text). Persistence is best-effort:
// failures degrade silently — localStorage remains the source of truth.

import { supabase } from '@/integrations/supabase/client';

export interface RemoteChatThread {
  id: string;
  user_id: string;
  title: string;
  mode: string;
  model: string;
  messages: unknown;
  created_at: string;
  updated_at: string;
}

export async function fetchRemoteThreads(userId: string): Promise<RemoteChatThread[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('ai_chat_threads' as never)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) {
      console.warn('[ai-chat] fetch failed', error.message);
      return [];
    }
    return (data as unknown as RemoteChatThread[]) || [];
  } catch (err) {
    console.warn('[ai-chat] fetch error', err);
    return [];
  }
}

export async function upsertRemoteThread(userId: string, thread: {
  id: string; title: string; mode: string; model: string;
  messages: unknown; createdAt: number; updatedAt: number;
}): Promise<void> {
  if (!userId || !thread.id) return;
  try {
    const { error } = await supabase
      .from('ai_chat_threads' as never)
      .upsert({
        id: thread.id,
        user_id: userId,
        title: thread.title,
        mode: thread.mode,
        model: thread.model,
        messages: thread.messages,
        created_at: new Date(thread.createdAt).toISOString(),
        updated_at: new Date(thread.updatedAt).toISOString(),
      } as never, { onConflict: 'id' });
    if (error) console.warn('[ai-chat] upsert failed', error.message);
  } catch (err) {
    console.warn('[ai-chat] upsert error', err);
  }
}

export async function deleteRemoteThread(userId: string, threadId: string): Promise<void> {
  if (!userId || !threadId) return;
  try {
    const { error } = await supabase
      .from('ai_chat_threads' as never)
      .delete()
      .eq('id', threadId)
      .eq('user_id', userId);
    if (error) console.warn('[ai-chat] delete failed', error.message);
  } catch (err) {
    console.warn('[ai-chat] delete error', err);
  }
}