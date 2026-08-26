/**
 * Prefixed logging behind a debug flag.
 *
 * Rule for this codebase: no bare `console.log`. Content scripts run inside
 * YouTube's console, so anything we print has to be identifiable as ours and
 * has to be silenceable.
 *
 * Enable at runtime from any console:  localStorage.v2fDebug = '1'
 * (In the service worker there is no localStorage, so DEV builds log by default.)
 */
const PREFIX = '[vid2friend]'

function debugEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('v2fDebug') === '1') {
      return true
    }
  } catch {
    // localStorage can throw in sandboxed contexts - never let logging break flow.
  }
  return import.meta.env.DEV
}

export const log = {
  debug(...args: unknown[]): void {
    if (debugEnabled()) console.debug(PREFIX, ...args)
  },
  info(...args: unknown[]): void {
    if (debugEnabled()) console.info(PREFIX, ...args)
  },
  /** Warnings are always shown: they mean a selector broke or a call failed. */
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args)
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args)
  },
}

/**
 * Logs a given message only once per session. Used for broken DOM selectors:
 * a MutationObserver would otherwise print the same warning hundreds of times.
 */
const seen = new Set<string>()
export function warnOnce(key: string, ...args: unknown[]): void {
  if (seen.has(key)) return
  seen.add(key)
  console.warn(PREFIX, ...args)
}
