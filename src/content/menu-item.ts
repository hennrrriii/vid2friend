/**
 * "Share with friends" as an extra entry in the three dot menu of a video tile.
 *
 * The hard part is not inserting the entry, it is knowing WHICH video the open
 * menu belongs to. YouTube reuses one `ytd-menu-popup-renderer` for every menu
 * on the page and simply re-populates it, so by the time the menu is open there
 * is no link left from the popup back to the tile.
 *
 * The reliable trick: remember the tile on `pointerdown`, in the capture phase,
 * before YouTube does anything. Whatever was last clicked is what the menu
 * belongs to.
 *
 * Two things this used to get wrong, both worth knowing before changing it:
 *
 *   1. It only recorded clicks that passed through a `ytd-menu-renderer`.
 *      Search results still use that component, but the homepage and channel
 *      pages have moved to `yt-lockup-view-model`, where the overflow button is
 *      not wrapped in one. Result: the entry appeared only after a search. Now
 *      every pointerdown records its tile, or clears it when there is none.
 *
 *   2. `Element.closest()` does not cross shadow roots, and parts of YouTube
 *      are inside them. `event.composedPath()` does, so we walk that instead.
 */
import { claim, el, parseDuration, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { SELECTORS } from './selectors'
import { openShareModal } from './share-modal'
import { log } from '@/shared/log'
import type { VideoMeta } from '@/shared/types'

const ITEM_KEY = 'menu-item'

let lastTile: Element | null = null

export function initMenuItem(): void {
  // pointerdown rather than mousedown: same timing, but it also covers touch
  // and pen input.
  document.addEventListener(
    'pointerdown',
    (event) => {
      try {
        lastTile = tileFromEvent(event)
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
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
  </svg>`

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
