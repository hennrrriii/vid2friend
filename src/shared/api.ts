/**
 * Every database call the extension makes, in one file.
 *
 * Rules kept throughout:
 *   - Nothing here throws a raw Postgres error at the UI. Callers get an Error
 *     whose message is already human readable, via toUserMessage().
 *   - Every call has a timeout. A hanging request must not turn into a spinner
 *     that never stops.
 */
import { getSupabase } from './supabase'
import { toUserMessage, withTimeout } from './errors'
import type {
  Friend,
  Friendship,
  Profile,
  PublicProfile,
  Share,
  ShelfItem,
  VideoMeta,
} from './types'

/** Unwraps a Supabase result and rethrows with a message a person can read. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw new Error(toUserMessage(result.error))
  if (result.data === null) throw new Error(toUserMessage(new Error('no data')))
  return result.data
}

const SENDER_EMBED = 'sender:profiles!shares_sender_id_fkey(id,username,avatar_color)'
const RECIPIENT_EMBED = 'recipient:profiles!shares_recipient_id_fkey(id,username,avatar_color)'

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Your own profile, or null if you have not picked a display name yet. */
export async function getMyProfile(): Promise<Profile | null> {
  const supabase = getSupabase()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const result = await withTimeout(
    supabase.from('profiles').select('*').eq('auth_uid', auth.user.id).maybeSingle(),
  )
  if (result.error) throw new Error(toUserMessage(result.error))
  return (result.data as Profile | null) ?? null
}

export async function createProfile(username: string): Promise<Profile> {
  const supabase = getSupabase()
  return unwrap(await withTimeout(supabase.rpc('bootstrap_profile', { p_username: username })))
}

export async function updateProfile(
  patch: Partial<Pick<Profile, 'username' | 'slot_count' | 'expire_after_days' | 'paused'>>,
): Promise<void> {
  const supabase = getSupabase()
  const profile = await getMyProfile()
  if (!profile) throw new Error('No profile yet.')

  const result = await withTimeout(supabase.from('profiles').update(patch).eq('id', profile.id))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function getRecoveryCode(): Promise<string | null> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase.from('profile_secrets').select('recovery_token').maybeSingle(),
  )
  if (result.error) throw new Error(toUserMessage(result.error))
  return (result.data as { recovery_token: string } | null)?.recovery_token ?? null
}

export async function rotateRecoveryCode(): Promise<string> {
  const supabase = getSupabase()
  return unwrap(await withTimeout(supabase.rpc('rotate_recovery_token')))
}

export async function restoreAccount(code: string): Promise<Profile> {
  const supabase = getSupabase()
  return unwrap(
    await withTimeout(supabase.rpc('claim_profile', { p_token: code.trim().toLowerCase() })),
  )
}

export async function deleteAccount(): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.rpc('delete_account'))
  if (result.error) throw new Error(toUserMessage(result.error))
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

/**
 * All friendships in one list, flattened so the popup does not have to care
 * which side of the row you are on.
 */
export async function listFriends(myProfileId: string): Promise<Friend[]> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase
      .from('friendships')
      .select(
        'id,status,created_at,responded_at,requester_id,addressee_id,' +
          'requester:profiles!friendships_requester_id_fkey(id,username,avatar_color),' +
          'addressee:profiles!friendships_addressee_id_fkey(id,username,avatar_color)',
      )
      .order('created_at', { ascending: false }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))

  type Row = Friendship & { requester: PublicProfile; addressee: PublicProfile }

  return ((result.data ?? []) as unknown as Row[]).map((row) => {
    const iAmRequester = row.requester_id === myProfileId
    return {
      friendshipId: row.id,
      profile: iAmRequester ? row.addressee : row.requester,
      status: row.status,
      direction: iAmRequester ? 'outgoing' : 'incoming',
      since: row.responded_at ?? row.created_at,
    }
  })
}

export async function sendFriendRequest(code: string): Promise<Friendship> {
  const supabase = getSupabase()
  return unwrap(
    await withTimeout(supabase.rpc('send_friend_request', { p_code: code.trim().toUpperCase() })),
  )
}

export async function respondToFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase.rpc('respond_friend_request', { p_friendship: friendshipId, p_accept: accept }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function removeFriend(profileId: string): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.rpc('remove_friend', { p_friend: profileId }))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function findByCode(code: string): Promise<PublicProfile | null> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase.rpc('find_profile_by_code', { p_code: code.trim().toUpperCase() }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))
  const rows = (result.data ?? []) as PublicProfile[]
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

/** The active shares only: exactly what the shelf renders, already in order. */
export async function getShelf(myProfileId: string): Promise<ShelfItem[]> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase
      .from('shares')
      .select(`*, ${SENDER_EMBED}`)
      .eq('recipient_id', myProfileId)
      .eq('status', 'active')
      .order('slot_position', { ascending: true }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))

  return ((result.data ?? []) as unknown as (Share & { sender: PublicProfile })[]).map(
    ({ sender, ...share }) => ({ share, sender }),
  )
}

/** Everything still open for me: the shelf plus what is waiting behind it. */
export async function getInbox(myProfileId: string): Promise<ShelfItem[]> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase
      .from('shares')
      .select(`*, ${SENDER_EMBED}`)
      .eq('recipient_id', myProfileId)
      .in('status', ['active', 'queued'])
      .order('slot_position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))

  return ((result.data ?? []) as unknown as (Share & { sender: PublicProfile })[]).map(
    ({ sender, ...share }) => ({ share, sender }),
  )
}

export interface SentShare {
  share: Share
  recipient: PublicProfile
}

/** What I sent, newest first, including what has already been watched. */
export async function getOutbox(myProfileId: string): Promise<SentShare[]> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase
      .from('shares')
      .select(`*, ${RECIPIENT_EMBED}`)
      .eq('sender_id', myProfileId)
      .order('sender_priority', { ascending: true })
      .order('created_at', { ascending: true }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))

  return ((result.data ?? []) as unknown as (Share & { recipient: PublicProfile })[]).map(
    ({ recipient, ...share }) => ({ share, recipient }),
  )
}

export interface ShareOutcome {
  recipientId: string
  ok: boolean
  /** Position in that person's queue, 1 based, for the confirmation toast. */
  queuePosition?: number
  error?: string
}

/**
 * Sends one video to one or more friends.
 *
 * Each recipient is inserted separately on purpose: if one fails (their queue
 * is full, you were just unfriended) the others still go through, and the modal
 * can say exactly which one did not work.
 */
export async function createShares(
  myProfileId: string,
  recipientIds: readonly string[],
  meta: VideoMeta,
  note: string | null,
): Promise<ShareOutcome[]> {
  const supabase = getSupabase()

  const results = await Promise.all(
    recipientIds.map(async (recipientId): Promise<ShareOutcome> => {
      try {
        const inserted = unwrap(
          await withTimeout(
            supabase
              .from('shares')
              .insert({
                sender_id: myProfileId,
                recipient_id: recipientId,
                video_id: meta.videoId,
                video_title: meta.title,
                channel_name: meta.channelName,
                duration_seconds: meta.durationSeconds,
                note: note && note.trim() ? note.trim().slice(0, 140) : null,
              })
              .select('id')
              .single(),
          ),
        ) as Pick<Share, 'id'>

        // Deliberately a second read. RETURNING gives the row as it looked
        // after the BEFORE triggers, and recalculate_slots runs in an AFTER
        // trigger - so the freshly inserted row would always claim to be
        // queued, even when it went straight onto the shelf.
        const placed = await withTimeout(
          supabase
            .from('shares')
            .select('status,slot_position')
            .eq('id', inserted.id)
            .maybeSingle(),
        )
        const row = placed.data as Pick<Share, 'status' | 'slot_position'> | null

        const position =
          row?.status === 'active' && row.slot_position !== null
            ? row.slot_position + 1
            : await queueDepth(recipientId, myProfileId)

        return { recipientId, ok: true, queuePosition: position }
      } catch (error) {
        return { recipientId, ok: false, error: toUserMessage(error) }
      }
    }),
  )

  return results
}

/** How many of my shares are still waiting for this person. */
async function queueDepth(recipientId: string, myProfileId: string): Promise<number> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase
      .from('shares')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', recipientId)
      .eq('sender_id', myProfileId)
      .in('status', ['queued', 'active']),
  )
  return result.count ?? 1
}

export async function markWatched(shareId: string): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.rpc('mark_share_watched', { p_share: shareId }))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function dismissShare(shareId: string): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.rpc('dismiss_share', { p_share: shareId }))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function undismissShare(shareId: string): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.rpc('undismiss_share', { p_share: shareId }))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function unshare(shareId: string): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(supabase.from('shares').delete().eq('id', shareId))
  if (result.error) throw new Error(toUserMessage(result.error))
}

export async function reorderQueue(recipientId: string, shareIds: string[]): Promise<void> {
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase.rpc('reorder_shares', { p_recipient: recipientId, p_share_ids: shareIds }),
  )
  if (result.error) throw new Error(toUserMessage(result.error))
}

/** Which of these friends already have this video waiting from someone. */
export async function friendsAlreadyQueued(
  videoId: string,
  friendIds: readonly string[],
): Promise<string[]> {
  if (friendIds.length === 0) return []
  const supabase = getSupabase()
  const result = await withTimeout(
    supabase.rpc('friends_already_queued', {
      p_video_id: videoId,
      p_friend_ids: friendIds,
    }),
  )
  if (result.error) return [] // A missing hint is not worth an error dialog.
  return (result.data ?? []) as string[]
}
