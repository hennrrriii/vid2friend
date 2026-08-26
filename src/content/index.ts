/**
 * Content script entry point, running on https://www.youtube.com/*.
 *
 * Ground rules for everything under src/content (see CONTRIBUTING-NOTES.md):
 *   1. Never throw into YouTube. Every DOM touch is wrapped and fails silently.
 *   2. Every injection is idempotent - check for `[data-v2f]` before inserting.
 *   3. Every selector lives in ./selectors.ts, nowhere else.
 *
 * Milestone 1: proves the script loads and that navigation events fire.
 * Shelf, menu item, watch button and modal arrive in milestones 4-6.
 */
import { log } from '@/shared/log'

const BOOT_FLAG = '__v2fContentLoaded'

function boot(): void {
  // YouTube can re-run scripts on soft navigations in some edge cases.
  const w = window as unknown as Record<string, unknown>
  if (w[BOOT_FLAG]) return
  w[BOOT_FLAG] = true

  log.info('content script ready on', location.pathname)

  // YouTube is an SPA: this fires on every in-app navigation instead of a reload.
  document.addEventListener('yt-navigate-finish', () => {
    log.debug('yt-navigate-finish', location.pathname)
  })
}

try {
  boot()
} catch (error) {
  // Nothing we do is important enough to break the page over.
  log.error('boot failed', error)
}
