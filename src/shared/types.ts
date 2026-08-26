/** Shapes that mirror the database. Kept hand written on purpose: the schema is
 *  small, and generated Supabase types would drag in a lot of noise for four
 *  tables. If the schema changes, change this file in the same commit. */

export type FriendshipStatus = 'pending' | 'accepted' | 'declined'
export type ShareStatus = 'queued' | 'active' | 'watched' | 'dismissed' | 'expired'

/** Your own profile. Other people's profiles never carry friend_code. */
export interface Profile {
  id: string
  username: string
  friend_code: string
  avatar_color: string
  slot_count: number
  expire_after_days: number
  paused: boolean
  created_at: string
}

/** What you are allowed to know about someone else. */
export interface PublicProfile {
  id: string
  username: string
  avatar_color: string
}

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: FriendshipStatus
  created_at: string
  responded_at: string | null
}

export interface Share {
  id: string
  sender_id: string
  recipient_id: string
  video_id: string
  video_title: string | null
  channel_name: string | null
  duration_seconds: number | null
  note: string | null
  sender_priority: number
  status: ShareStatus
  slot_position: number | null
  created_at: string
  activated_at: string | null
  watched_at: string | null
}

/** A friend, seen from your side, including requests in either direction. */
export interface Friend {
  friendshipId: string
  profile: PublicProfile
  status: FriendshipStatus
  /** 'incoming' means they asked you and you have not answered yet. */
  direction: 'incoming' | 'outgoing'
  since: string
}

/** One card on the YouTube shelf: the share plus who sent it. */
export interface ShelfItem {
  share: Share
  sender: PublicProfile
}

/** Video metadata scraped from the YouTube DOM at share time. */
export interface VideoMeta {
  videoId: string
  title: string | null
  channelName: string | null
  durationSeconds: number | null
}

/**
 * The snapshot the service worker keeps in chrome.storage.local so the shelf
 * can paint before any network call finishes. Treat it as possibly stale but
 * never as wrong-shaped.
 */
export interface CachedState {
  version: 1
  profileId: string | null
  username: string | null
  slotCount: number
  paused: boolean
  /** Active shares, already sorted by slot_position. */
  shelf: ShelfItem[]
  /** Number of friend requests waiting for an answer. */
  pendingRequests: number
  /**
   * Everything still queued or active, reduced to what the watch tracker needs:
   * which video, and which share row to mark when it has been watched.
   */
  openShares: { shareId: string; videoId: string }[]
  updatedAt: number
}

export const EMPTY_STATE: CachedState = {
  version: 1,
  profileId: null,
  username: null,
  slotCount: 6,
  paused: false,
  shelf: [],
  pendingRequests: 0,
  openShares: [],
  updatedAt: 0,
}
