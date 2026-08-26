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
  let response: Response<ResponseMap[K]> | undefined
  try {
    response = (await chrome.runtime.sendMessage(request)) as
      | Response<ResponseMap[K]>
      | undefined
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('Extension context invalidated')
        ? 'vid2friend was reloaded. Refresh this page.'
        : 'vid2friend is not responding. Try reloading the page.',
    )
  }

  if (!response) throw new Error('vid2friend is not responding. Try reloading the page.')
  if (!response.ok) throw new Error(response.error)
  return response.data
}
