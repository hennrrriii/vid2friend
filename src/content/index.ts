/**
 * Content script entry point, running on https://www.youtube.com/*.
 *
 * Ground rules for everything under src/content:
 *   1. Never throw into YouTube. Every DOM touch is wrapped and fails silently.
 *   2. Every injection is idempotent - check for `[data-v2f]` before inserting.
 *   3. Every selector lives in ./selectors.ts, nowhere else.
 *
 * Order matters here: styles first so nothing flashes unstyled, then the cached
 * state so the shelf can paint on the first tick, and only then the network.
 */
import { log } from '@/shared/log'
import { SHELF_CSS } from '@/styles/shelf-css'
import { onPageChange } from './dom'
import { initState } from './state'
import { initShelf, render as renderShelf } from './shelf'
import { initMenuItem, injectMenuItem } from './menu-item'
import { injectWatchButton } from './watch-button'
import { syncWatchTracker } from './watch-tracker'
import { checkConnectLink } from './connect-prompt'

const BOOT_FLAG = '__v2fContentLoaded'

function injectStyles(): void {
  if (document.querySelector('style[data-v2f="styles"]')) return
  const style = document.createElement('style')
  style.setAttribute('data-v2f', 'styles')
  style.textContent = SHELF_CSS
  document.head.append(style)
}

async function boot(): Promise<void> {
  const w = window as unknown as Record<string, unknown>
  if (w[BOOT_FLAG]) return
  w[BOOT_FLAG] = true

  injectStyles()
  initMenuItem()

  // Paints from the cache; the refresh inside initState corrects it moments
  // later. A slow network delays accuracy, never the first render.
  await initState()
  initShelf()

  onPageChange(() => {
    renderShelf()
    injectMenuItem()
    injectWatchButton()
    syncWatchTracker()
  })

  void checkConnectLink()

  log.info('ready on', location.pathname)
}

boot().catch((error) => {
  // Nothing we do is important enough to break YouTube over.
  log.error('boot failed', error)
})
