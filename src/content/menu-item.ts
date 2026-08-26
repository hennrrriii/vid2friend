/**
 * "Share with friends" as an extra entry in the three dot menu of a video tile.
 *
 * Three separate problems live here, and each of them broke the feature on its
 * own at some point:
 *
 *   1. WHICH video does the open menu belong to? YouTube reuses its menus and
 *      re-populates them, so once one is open there is no link back to the
 *      tile. Fixed by remembering the tile on `pointerdown` in the capture
 *      phase, via `event.composedPath()` rather than `closest()` - the latter
 *      does not cross shadow roots, and the newer tile components use them.
 *
 *   2. WHEN is the menu detectable? The page-wide MutationObserver in dom.ts
 *      only watches childList changes. Some pages build the menu fresh (a
 *      childList change), others reveal a hidden one by toggling an attribute
 *      (no childList change at all). Fixed by also rechecking on a few short
 *      timers after every tile click.
 *
 *   3. WHERE do we insert? See openMenuList() below. Short version: YouTube
 *      runs two different menu implementations at the same time, so we look for
 *      the menu's entries instead of for the menu.
 */
import { claim, el, parseDuration, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { logoMarkSvg } from '@/shared/brand'
import { SELECTORS } from './selectors'
import { openShareModal } from './share-modal'
import { log, warnOnce } from '@/shared/log'
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

/** Called on every DOM settle, and on a few timers after each tile click. */
export function injectMenuItem(): void {
  try {
    // Not a video tile menu (account menu, watch page overflow, sort menu, ...).
    if (!lastTile?.isConnected) return

    const list = openMenuList()
    if (!list) return

    const meta = metaFromTile(lastTile)
    if (!meta) {
      warnOnce(
        'menu-meta',
        'found an open menu but could not read the video from its tile. ' +
          'Check the tileLink selectors in src/content/selectors.ts.',
      )
      return
    }

    // Menus are recycled between videos, so an entry left over from the
    // previous one would share the wrong video. Stamp it and replace it when
    // the video changes.
    const existing = list.querySelector(`[data-v2f~="${ITEM_KEY}"]`)
    if (existing && existing.getAttribute('data-v2f-video') === meta.videoId) {
      // Already ours. Still re-run the resize, because YouTube reapplies its
      // own max-height while the menu settles.
      expandMenu(list)
      return
    }
    existing?.remove()

    list.append(buildItem(meta))
    expandMenu(list)
  } catch (error) {
    log.error('menu item injection failed', error)
  }
}

/**
 * Finds the container of the currently open menu, by looking for its entries
 * rather than for the menu itself.
 *
 * Why not just select the popup: YouTube ships at least two menu
 * implementations at once. Search results still use the Polymer
 * `ytd-menu-popup-renderer` with a `tp-yt-paper-listbox#items` inside; the
 * homepage and channel pages use a newer view-model based menu with neither of
 * those. Selecting on the wrapper therefore worked on exactly one kind of page,
 * which is precisely the bug this replaced.
 *
 * Entries, on the other hand, all look alike enough to enumerate. Whichever
 * element is the parent of the most VISIBLE entries is the open menu. The
 * visibility filter matters because YouTube keeps closed menus in the DOM.
 */
function openMenuList(): Element | null {
  const selector = SELECTORS.menuItem.join(',')

  const counts = new Map<Element, number>()
  for (const item of document.querySelectorAll(selector)) {
    if (!isVisible(item)) continue
    const parent = item.parentElement
    if (!parent) continue
    counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }

  let best: Element | null = null
  let bestCount = 0
  for (const [parent, count] of counts) {
    if (count > bestCount) {
      best = parent
      bestCount = count
    }
  }

  // Two entries is the floor for "this is a menu" - it keeps us from latching
  // onto a single stray element that happens to match.
  return bestCount >= 2 ? best : null
}

/** YouTube keeps closed menus in the DOM, so presence is not enough. */
function isVisible(element: Element): boolean {
  if (element.getClientRects().length === 0) return false
  return element.closest('[aria-hidden="true"]') === null
}

/**
 * Makes room for our extra entry.
 *
 * YouTube sizes its menus to their own content: the dropdown gets an inline
 * max-height and an internal scroll container. Adding a seventh entry to a menu
 * built for six therefore produces a scrollbar rather than a taller menu, and
 * ours is the entry at the bottom that you then have to scroll to.
 *
 * So: lift the height caps on the way up, then, if the menu now hangs off the
 * bottom of the window, move it up so it grows in that direction instead. If it
 * is genuinely taller than the viewport, put a scroll container back - a menu
 * you cannot see the top of would be worse than one that scrolls.
 *
 * Everything here is defensive. A menu we fail to resize is a cosmetic problem;
 * a thrown exception inside YouTube's event handling is not.
 */
function expandMenu(list: Element): void {
  try {
    const chain: HTMLElement[] = []
    let node: Element | null = list
    for (let depth = 0; node instanceof HTMLElement && depth < 8; depth += 1) {
      chain.push(node)
      if (node === document.body) break
      node = node.parentElement
    }

    for (const element of chain) {
      const style = getComputedStyle(element)
      if (style.maxHeight !== 'none') element.style.maxHeight = 'none'
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        element.style.overflowY = 'visible'
      }
    }

    // The dropdown positions itself with an inline `top`. That is the element
    // to move when the taller menu no longer fits below the button.
    const positioned = chain.find((element) => {
      const style = getComputedStyle(element)
      return style.position === 'fixed' || style.position === 'absolute'
    })
    if (!positioned) return

    // After a frame, so the browser has laid out the taller menu.
    requestAnimationFrame(() => {
      try {
        const margin = 8
        const rect = positioned.getBoundingClientRect()
        const available = window.innerHeight - margin * 2

        if (rect.height > available) {
          // Taller than the window even at full height: scroll after all.
          positioned.style.maxHeight = `${available}px`
          positioned.style.overflowY = 'auto'
          positioned.style.top = `${margin}px`
          return
        }

        if (rect.bottom > window.innerHeight - margin) {
          const currentTop = Number.parseFloat(positioned.style.top || String(rect.top)) || rect.top
          const shift = rect.bottom - (window.innerHeight - margin)
          positioned.style.top = `${Math.max(margin, currentTop - shift)}px`
        }
      } catch (error) {
        log.debug('menu reposition failed', error)
      }
    })
  } catch (error) {
    log.debug('menu expand failed', error)
  }
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
