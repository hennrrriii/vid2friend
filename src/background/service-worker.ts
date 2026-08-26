/**
 * MV3 service worker: the only part of the extension that talks to Supabase on
 * behalf of YouTube tabs.
 *
 * Everything here has to survive being killed at any moment. Nothing important
 * lives in module scope, every entry point re-establishes what it needs, and
 * the chrome.alarms poll is the safety net under the realtime subscription.
 */
import { log } from '@/shared/log'
import { isConfigured } from '@/shared/env'
import { toUserMessage } from '@/shared/errors'
import type { Request, Response } from '@/shared/messages'
import {
  createShares,
  dismissShare,
  findByCode,
  friendsAlreadyQueued,
  listFriends,
  markWatched,
  sendFriendRequest,
  undismissShare,
} from '@/shared/api'
import { currentState, refreshState } from './state'
import { startRealtime } from './realtime'

const POLL_ALARM = 'v2f-poll'
const POLL_PERIOD_MINUTES = 5

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed:', details.reason)
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES })
  void wake()

  // First install: open the popup so the user picks a name straight away
  // instead of wondering what the new icon does.
  if (details.reason === 'install') {
    void chrome.action.openPopup?.().catch(() => undefined)
  }
})

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES })
  void wake()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return
  void wake()
})

/** Re-establishes realtime and pulls fresh data. Safe to call repeatedly. */
async function wake(): Promise<void> {
  if (!isConfigured) {
    log.warn('Supabase is not configured. Fill in .env and rebuild. See README section 2.')
    return
  }
  await refreshState()
  await startRealtime()
}

// The worker may have just been spun up by an incoming message rather than by
// one of the lifecycle events above, so kick things off here too.
void wake()

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
// chrome.runtime.onMessage must return `true` synchronously to keep the channel
// open for an async reply. Every branch resolves through `reply`, so a thrown
// error still produces a response instead of leaving the caller hanging.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies Response))
    .catch((error) => {
      log.warn('message failed', message?.type, error)
      sendResponse({ ok: false, error: toUserMessage(error) } satisfies Response)
    })
  return true
})

async function handle(message: Request): Promise<unknown> {
  switch (message.type) {
    case 'state:get':
      return currentState()

    case 'state:refresh':
      return refreshState()

    case 'friends:list': {
      const state = await currentState()
      if (!state.profileId) return []
      return listFriends(state.profileId)
    }

    case 'friends:alreadyQueued':
      return friendsAlreadyQueued(message.videoId, message.friendIds)

    case 'friend:lookupCode':
      return findByCode(message.code)

    case 'friend:requestByCode': {
      const friendship = await sendFriendRequest(message.code)
      await refreshState()
      return { status: friendship.status, username: null }
    }

    case 'share:create': {
      const state = await currentState()
      if (!state.profileId) throw new Error('Set up your vid2friend profile first.')
      const outcomes = await createShares(
        state.profileId,
        message.recipientIds,
        message.meta,
        message.note,
      )
      await refreshState()
      return outcomes
    }

    case 'share:dismiss': {
      await dismissShare(message.shareId)
      const state = await refreshState()
      return state.shelf
    }

    case 'share:undismiss': {
      await undismissShare(message.shareId)
      await refreshState()
      return null
    }

    case 'share:watched': {
      await markWatched(message.shareId)
      await refreshState()
      return null
    }

    case 'openPopup': {
      await chrome.action.openPopup?.()
      return null
    }

    default: {
      // Exhaustiveness check: adding a message type without handling it here
      // becomes a compile error.
      const never: never = message
      throw new Error(`Unknown message: ${JSON.stringify(never)}`)
    }
  }
}
