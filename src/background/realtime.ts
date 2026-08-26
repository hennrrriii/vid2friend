/**
 * Supabase Realtime subscriptions.
 *
 * Treat this as an optimisation, never as the source of truth. An MV3 service
 * worker gets terminated after roughly 30 seconds of inactivity, which kills
 * the websocket with it. The chrome.alarms poll in index.ts is what actually
 * guarantees the data is eventually correct; realtime is what makes it feel
 * instant while the worker happens to be awake.
 */
import { getSupabase } from '@/shared/supabase'
import { getMyProfile } from '@/shared/api'
import { log } from '@/shared/log'
import { refreshState } from './state'
import type { RealtimeChannel } from '@supabase/supabase-js'

let channels: RealtimeChannel[] = []
let subscribedFor: string | null = null

export async function startRealtime(): Promise<void> {
  try {
    const profile = await getMyProfile()
    if (!profile) return
    if (subscribedFor === profile.id && channels.length > 0) return

    await stopRealtime()
    const supabase = getSupabase()

    // Shares addressed to me: a friend recommended something.
    const shares = supabase
      .channel('v2f-shares')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shares',
          filter: `recipient_id=eq.${profile.id}`,
        },
        () => void refreshState(),
      )
      .subscribe((status) => log.debug('realtime shares:', status))

    // Shares I sent: so "Henri watched your video" shows up without a reload.
    const sent = supabase
      .channel('v2f-sent')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shares',
          filter: `sender_id=eq.${profile.id}`,
        },
        () => void refreshState(),
      )
      .subscribe((status) => log.debug('realtime sent:', status))

    // Friend requests. No filter is possible here because either column may be
    // mine, and RLS already guarantees we only receive our own rows.
    const friendships = supabase
      .channel('v2f-friendships')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => void refreshState(),
      )
      .subscribe((status) => log.debug('realtime friendships:', status))

    channels = [shares, sent, friendships]
    subscribedFor = profile.id
  } catch (error) {
    log.debug('realtime start failed, polling will cover it', error)
  }
}

export async function stopRealtime(): Promise<void> {
  const open = channels
  channels = []
  subscribedFor = null
  await Promise.all(
    open.map((channel) => channel.unsubscribe().catch(() => undefined)),
  )
}
