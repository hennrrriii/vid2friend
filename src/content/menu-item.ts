/**
 * "Share with friends" as an extra entry in the three dot menu of a video tile.
 *
 * Two problems, solved independently:
 *
 *   1. WHICH video does the open menu belong to? YouTube reuses one
 *      `ytd-menu-popup-renderer` for every menu on the page and simply
 *      re-populates it, so once the menu is open there is no link left back to
 *      the tile. Fixed by remembering the tile on `pointerdown`, in the capture
 *      phase, via `event.composedPath()` rather than `closest()` - the latter
 *      does not cross shadow roots, and the newer `yt-lockup-view-model` tiles
 *      (homepage, channel pages) use real shadow DOM.
 *
 *   2. WHEN does the popup actually appear in a way we can detect? The
 *      page-wide MutationObserver in dom.ts only watches childList changes.
 *      Search results create the popup fresh each time, which is a childList
 *      change and got picked up. The homepage and channel pages instead reuse
 *      one hidden popup and reveal it by toggling an attribute - no childList
 *      change at all, so the entry silently never appeared there. Fixed by
 *      scheduling a handful of direct rechecks after every tile click,
 *      independent of what kind of mutation opened the menu.
 */
import { claim, el, parseDuration, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { logoMarkSvg } from '@/shared/brand'
import { SELECTORS } from './selectors'
import { openShareModal } from './share-modal'
import { log } from '@/shared/log'
import type { VideoMeta } from '@/shared/types'

const ITEM_KEY = 'menu-item'

/**
 * How long after a click on a tile to keep re-checking for an opened menu.
 *
 * The page-wide MutationObserver in dom.ts only watches childList changes, and
 * on the homepage and channel pages YouTube reuses one hidden popup element and
 * reveals it by toggling an attribute rather than inserting anything - which
 * produces no childList mutation at all. Search results still create the popup
 * fresh each time, which is why the entry used to appear there but nowhere
 * else. These retries are the fix: independent of what kind of mutation
 * actually opened the menu, several short delays after every relevant click
 * are enough to catch the popup once it becomes visible.
 */
const RECHECK_DELAYS_MS = [0, 50, 120, 250, 450]

let lastTile: Element | null = null

export function initMenuItem(): void {
  // pointerdown rather than mousedown: same timing, but it also covers touch
  // and pen input.
  document.addEventListener(
    'pointerdown',
    (event) => {
      try {
        lastTile = tileFromEvent(event)
        if (lastTile) {
          for (const delay of RECHECK_DELAYS_MS) {
            window.setTimeout(injectMenuItem, delay)
          }
        }
      } catch (error) {
        lastTile = null
        log.debug('tile tracking failed', error)
      }
    },
    true,
  )

  // A soft navigation invalidates whatever tile we were remembering.
  document.addEventListener('yt-navigate-finish', () => {
    lastTile = null
  })
}

/** Walks the composed path for the first element that is a video tile. */
function tileFromEvent(event: Event): Element | null {
  const selector = SELECTORS.videoTile.join(',')
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []

  for (const node of path) {
    if (!(node instanceof Element)) continue
    try {
      if (node.matches(selector)) return node
    } catch {
      /* a selector YouTube's parser dislikes; try the next one */
    }
  }

  // Fallback for browsers or events without a composed path.
  const target = event.target
  return target instanceof Element ? target.closest(selector) : null
}

/** Called on every DOM settle. Cheap when no menu is open. */
export function injectMenuItem(): void {
  try {
    const popup = pickQuiet('menuPopup')
    if (!popup || !isVisible(popup)) return

    // Not a video tile menu (account menu, watch page overflow, ...).
    if (!lastTile?.isConnected) return

    const list = pickQuiet('menuList', popup)
    if (!list) return

    const meta = metaFromTile(lastTile)
    if (!meta) return

    // The popup is recycled between videos, so an entry left over from the
    // previous menu would share the wrong video. Stamp it and replace it when
    // the video changes.
    const existing = list.querySelector(`[data-v2f~="${ITEM_KEY}"]`)
    if (existing) {
      if (existing.getAttribute('data-v2f-video') === meta.videoId) return
      existing.remove()
    }

    list.append(buildItem(meta))
  } catch (error) {
    log.error('menu item injection failed', error)
  }
}

/**
 * YouTube keeps the dropdown in the DOM and hides it instead of removing it.
 * Injecting into a hidden popup would silently attach our entry to the wrong
 * video the next time it opens.
 */
function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  return element.closest('[aria-hidden="true"]') === null
}

function buildItem(meta: VideoMeta): HTMLElement {
  const icon = el('span', { class: 'v2f-menu-item__icon' })
  // The brand mark, not a generic icon - so the entry reads as "this is a
  // vid2friend feature" at a glance among YouTube's own menu items.
  icon.innerHTML = logoMarkSvg(20)

  const item = el(
    'div',
    {
      class: 'v2f-menu-item',
      role: 'menuitem',
      tabindex: '0',
      'data-v2f-video': meta.videoId,
    },
    [icon, el('span', {}, ['Share with friends'])],
  )

  claim(item, ITEM_KEY)

  const activate = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    closeYouTubeMenu()
    void openShareModal(meta)
  }

  item.addEventListener('click', activate)
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event)
  })

  return item
}

/**
 * Closes the dropdown we were just inside. Tries the Polymer element's own
 * close() first, falls back to an Escape key event, and gives up quietly.
 */
function closeYouTubeMenu(): void {
  try {
    const dropdown = document.querySelector('tp-yt-iron-dropdown') as
      | (Element & { close?: () => void })
      | null
    if (typeof dropdown?.close === 'function') {
      dropdown.close()
      return
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  } catch (error) {
    log.debug('could not close the YouTube menu', error)
  }
}

/**
 * Reads title, channel, duration and id out of one video tile.
 * Everything except the id is optional: a missing channel name is a slightly
 * emptier card, a missing id means we cannot share at all.
 */
export function metaFromTile(tile: Element): VideoMeta | null {
  const link = pickQuiet('tileLink', tile) as HTMLAnchorElement | null
  const videoId = videoIdFromUrl(link?.getAttribute('href') ?? null)
  if (!videoId) return null

  return {
    videoId,
    title: textOf('tileTitle', tile) ?? link?.getAttribute('title') ?? null,
    channelName: textOf('tileChannel', tile),
    durationSeconds: parseDuration(textOf('tileDuration', tile)),
  }
}
