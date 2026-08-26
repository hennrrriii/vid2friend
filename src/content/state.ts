/**
 * The content script's view of the world.
 *
 * Reads the cached snapshot straight out of chrome.storage.local so the shelf
 * can render on the first frame, then lets the service worker push updates.
 * No Supabase client lives in this context.
 */
import { readCachedState } from '@/shared/storage'
import { EMPTY_STATE, type CachedState } from '@/shared/types'
import { send } from '@/shared/messages'
import { log } from '@/shared/log'

let current: CachedState = EMPTY_STATE
const listeners = new Set<(state: CachedState) => void>()

export function getState(): CachedState {
  return current
}

export function onStateChange(listener: (state: CachedState) => void): void {
  listeners.add(listener)
}

function publish(state: CachedState): void {
  current = state
  for (const listener of listeners) {
    try {
      listener(state)
    } catch (error) {
      log.error('state listener failed', error)
    }
  }
}

/**
 * Two phases on purpose: the cache paints immediately, the refresh corrects it
 * a moment later. If the refresh fails (offline, worker asleep) the cached view
 * simply stays, which is much better than an empty page.
 */
export async function initState(): Promise<void> {
  publish(await readCachedState())

  chrome.runtime.onMessage.addListener((message: { type?: string; state?: CachedState }) => {
    if (message?.type === 'state:changed' && message.state) {
      publish(message.state)
    }
  })

  try {
    publish(await send({ type: 'state:refresh' }))
  } catch (error) {
    log.debug('initial refresh failed, using cache', error)
  }
}

/** Nudges the service worker for fresh data, ignoring failures. */
export async function refresh(): Promise<void> {
  try {
    publish(await send({ type: 'state:refresh' }))
  } catch (error) {
    log.debug('refresh failed', error)
  }
}
