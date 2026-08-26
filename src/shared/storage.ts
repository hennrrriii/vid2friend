/**
 * chrome.storage.local helpers, plus the storage adapter Supabase needs.
 *
 * Why an adapter at all: supabase-js persists the session in `localStorage` by
 * default. An MV3 service worker has no `localStorage` and no `window`, so
 * without this the session would silently vanish every time Chrome shut the
 * worker down, and the user would be logged out constantly.
 *
 * chrome.storage.local is available in the service worker, the popup and
 * content scripts alike, which also means all three see the same session.
 */
import { EMPTY_STATE, type CachedState } from './types'
import { log } from './log'

export const AUTH_STORAGE_KEY = 'v2f-auth'
const STATE_KEY = 'v2f-state'

/** Supabase's SupportedStorage interface, implemented on chrome.storage.local. */
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const result = await chrome.storage.local.get(key)
      const value = result[key]
      return typeof value === 'string' ? value : null
    } catch (error) {
      log.error('storage read failed', key, error)
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: value })
    } catch (error) {
      log.error('storage write failed', key, error)
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key)
    } catch (error) {
      log.error('storage remove failed', key, error)
    }
  },
}

/**
 * Last known state. Returns EMPTY_STATE rather than throwing when nothing has
 * been cached yet or the cache is from an older, incompatible version.
 */
export async function readCachedState(): Promise<CachedState> {
  try {
    const result = await chrome.storage.local.get(STATE_KEY)
    const cached = result[STATE_KEY] as CachedState | undefined
    if (!cached || cached.version !== 1) return EMPTY_STATE
    return cached
  } catch (error) {
    log.error('state read failed', error)
    return EMPTY_STATE
  }
}

export async function writeCachedState(state: CachedState): Promise<void> {
  try {
    await chrome.storage.local.set({ [STATE_KEY]: { ...state, updatedAt: Date.now() } })
  } catch (error) {
    log.error('state write failed', error)
  }
}

export async function clearAll(): Promise<void> {
  try {
    await chrome.storage.local.clear()
  } catch (error) {
    log.error('storage clear failed', error)
  }
}

/**
 * Local-only preferences that never need to reach the server.
 * `onboarded` gates the first-run screen in the popup.
 */
export interface LocalPrefs {
  onboarded: boolean
  /**
   * Whether the empty slots on the shelf are collapsed. Per browser, not per
   * account: it is a viewing preference, not something a friend should inherit
   * from you. Default false, so a new user sees how many slots they have.
   */
  hideEmptySlots: boolean
}

const PREFS_KEY = 'v2f-prefs'
const DEFAULT_PREFS: LocalPrefs = { onboarded: false, hideEmptySlots: false }

export async function readPrefs(): Promise<LocalPrefs> {
  try {
    const result = await chrome.storage.local.get(PREFS_KEY)
    return { ...DEFAULT_PREFS, ...(result[PREFS_KEY] as Partial<LocalPrefs> | undefined) }
  } catch {
    return DEFAULT_PREFS
  }
}

export async function writePrefs(patch: Partial<LocalPrefs>): Promise<void> {
  const current = await readPrefs()
  await chrome.storage.local.set({ [PREFS_KEY]: { ...current, ...patch } })
}
