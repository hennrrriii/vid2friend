/**
 * The single place where "what does this user currently have" is computed.
 *
 * Everything else in the extension reads the cached snapshot rather than
 * querying Supabase itself, which is what makes the shelf paint instantly on a
 * cold YouTube page load instead of after a network round trip.
 */
import { ensureSession } from '@/shared/supabase'
import { getInbox, getMyProfile, listFriends } from '@/shared/api'
import { readCachedState, writeCachedState } from '@/shared/storage'
import { EMPTY_STATE, type CachedState } from '@/shared/types'
import { log } from '@/shared/log'
import { toUserMessage } from '@/shared/errors'

let refreshing: Promise<CachedState> | null = null

/**
 * Refetches everything and updates the cache, the badge and every open tab.
 *
 * Concurrent calls share one in-flight request: the alarm, a realtime event and
 * a popup opening at the same moment should not produce three round trips.
 */
export async function refreshState(): Promise<CachedState> {
  if (refreshing) return refreshing

  refreshing = (async () => {
    try {
      await ensureSession()

      const profile = await getMyProfile()
      if (!profile) {
        // Signed in, but no display name picked yet. Perfectly normal on first
        // run; the popup shows onboarding and nothing is rendered on YouTube.
        const state: CachedState = { ...EMPTY_STATE, updatedAt: Date.now() }
        await commit(state)
        return state
      }

      const [inbox, friends] = await Promise.all([
        getInbox(profile.id),
        listFriends(profile.id),
      ])

      const state: CachedState = {
        version: 1,
        profileId: profile.id,
        username: profile.username,
        slotCount: profile.slot_count,
        paused: profile.paused,
        shelf: inbox
          .filter((item) => item.share.status === 'active')
          .sort((a, b) => (a.share.slot_position ?? 0) - (b.share.slot_position ?? 0)),
        pendingRequests: friends.filter(
          (f) => f.status === 'pending' && f.direction === 'incoming',
        ).length,
        openShares: inbox.map((item) => ({
          shareId: item.share.id,
          videoId: item.share.video_id,
        })),
        updatedAt: Date.now(),
      }

      await commit(state)
      return state
    } catch (error) {
      log.warn('refresh failed:', toUserMessage(error))
      // Keep serving the last known good state rather than blanking the shelf
      // because the network blipped.
      return readCachedState()
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

async function commit(state: CachedState): Promise<void> {
  await writeCachedState(state)
  await updateBadge(state)
  broadcast(state)
}

/**
 * Badge = unwatched recommendations on the shelf plus friend requests waiting
 * for an answer. Both are things the user is expected to act on.
 */
async function updateBadge(state: CachedState): Promise<void> {
  const count = state.shelf.length + state.pendingRequests
  try {
    await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' })
    await chrome.action.setBadgeBackgroundColor({ color: '#2467d4' })
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' })
  } catch (error) {
    log.debug('badge update failed', error)
  }
}

/**
 * Pushes the new state into every open YouTube tab.
 *
 * We do not hold the `tabs` permission, so we ask for all tabs and keep the
 * ones whose URL we are actually allowed to see - which, thanks to
 * host_permissions, is exactly the YouTube ones.
 */
export function broadcast(state: CachedState): void {
  chrome.tabs
    .query({})
    .then((tabs) => {
      for (const tab of tabs) {
        if (!tab.id || !tab.url?.startsWith('https://www.youtube.com/')) continue
        chrome.tabs
          .sendMessage(tab.id, { type: 'state:changed', state })
          .catch(() => {
            // Tab has no content script yet (still loading, or the extension was
            // just installed). Nothing to do; it will pull on boot.
          })
      }
    })
    .catch((error) => log.debug('tab broadcast failed', error))

  // The popup listens on the same channel. If it is closed this rejects, which
  // is expected and uninteresting.
  chrome.runtime.sendMessage({ type: 'state:changed', state }).catch(() => {})
}

export async function currentState(): Promise<CachedState> {
  const cached = await readCachedState()
  // Older than five minutes means the worker was asleep through some changes.
  if (Date.now() - cached.updatedAt > 5 * 60_000) {
    void refreshState()
  }
  return cached
}
