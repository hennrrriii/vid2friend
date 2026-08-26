/**
 * The message protocol between the content script, the popup and the service
 * worker.
 *
 * The content script owns no Supabase client, so every read and write it needs
 * goes through here. Keeping the union in one file means a typo in a message
 * name is a compile error rather than a silent no-op at runtime.
 */
import type { CachedState, Friend, PublicProfile, ShelfItem, VideoMeta } from './types'
import type { ShareOutcome } from './api'

export type Request =
  /** Cheap: answers from the cache, no network. */
  | { type: 'state:get' }
  /** Refetches from Supabase and broadcasts the result. */
  | { type: 'state:refresh' }
  | { type: 'friends:list' }
  | { type: 'friends:alreadyQueued'; videoId: string; friendIds: string[] }
  | { type: 'friend:lookupCode'; code: string }
  | { type: 'friend:requestByCode'; code: string }
  /** Answering an invite link, which is a different act from asking. */
  | { type: 'friend:answerInvite'; code: string; accept: boolean }
  | { type: 'share:create'; recipientIds: string[]; meta: VideoMeta; note: string | null }
  | { type: 'share:dismiss'; shareId: string }
  | { type: 'share:undismiss'; shareId: string }
  | { type: 'share:watched'; shareId: string }
  /** The content script found ?v2f=CODE and the user confirmed the prompt. */
  | { type: 'openPopup' }

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** Pushed from the service worker to every open YouTube tab and the popup. */
export type Broadcast =
  | { type: 'state:changed'; state: CachedState }
  | { type: 'friends:changed' }

export interface ResponseMap {
  'state:get': CachedState
  'state:refresh': CachedState
  'friends:list': Friend[]
  'friends:alreadyQueued': string[]
  'friend:lookupCode': PublicProfile | null
  'friend:requestByCode': { status: string; username: string | null }
  'friend:answerInvite': { status: string }
  'share:create': ShareOutcome[]
  'share:dismiss': ShelfItem[]
  'share:undismiss': null
  'share:watched': null
  openPopup: null
}

/**
 * Typed wrapper around chrome.runtime.sendMessage.
 *
 * Rejects instead of resolving with `undefined` when the service worker is
 * asleep or the extension was reloaded mid-session, which is the single most
 * common runtime failure in an MV3 extension.
 */
export async function send<K extends Request['type']>(
  request: Extract<Request, { type: K }>,
): Promise<ResponseMap[K]> {
  // One retry, then give up. MV3 terminates the service worker aggressively;
  // the first message after that is supposed to wake it, but occasionally
  // arrives while it is still starting and comes back with no receiver. A
  // single retry a moment later turns that into a non-event.
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 350))
    try {
      const response = (await chrome.runtime.sendMessage(request)) as
        | Response<ResponseMap[K]>
        | undefined
      if (!response) throw new Error('no response')
      if (!response.ok) throw new Error(response.error)
      return response.data
    } catch (error) {
      // An error the service worker deliberately sent back is a real answer,
      // not a transport problem. Do not retry those.
      if (isApplicationError(error)) throw error
      lastError = error
    }
  }

  throw new Error(describeTransportFailure(lastError))
}

/** True for errors our own handler produced, as opposed to Chrome messaging. */
function isApplicationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message
  if (message === 'no response') return false
  return !TRANSPORT_HINTS.some((hint) => message.includes(hint))
}

const TRANSPORT_HINTS = [
  'Extension context invalidated',
  'Could not establish connection',
  'Receiving end does not exist',
  'message port closed',
  'The message port closed',
]

function describeTransportFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (message.includes('Extension context invalidated')) {
    return 'vid2friend was reloaded. Refresh this page (F5).'
  }
  return (
    'vid2friend could not reach its background service. ' +
    'Open chrome://extensions, click Reload on vid2friend, then refresh this page. ' +
    'If it keeps happening, click "Service Worker" there to see the actual error.'
  )
}
