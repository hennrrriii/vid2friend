/**
 * "Share with friends" as an extra entry in the three dot menu of a video tile.
 *
 * The hard part is not inserting the entry, it is knowing WHICH video the open
 * menu belongs to. YouTube reuses one `ytd-menu-popup-renderer` for every menu
 * on the page and simply re-populates it, so by the time the menu is open there
 * is no link left from the popup back to the tile.
 *
 * The reliable trick: remember the tile at mousedown on the three dot button,
 * in the capture phase, before YouTube does anything. That element is the
 * answer, and it is still the answer when the menu finishes opening.
 */
import { claim, closestTile, el, parseDuration, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { openShareModal } from './share-modal'
import { log } from '@/shared/log'
import { BRAND } from '@/shared/brand'
import type { VideoMeta } from '@/shared/types'

const ITEM_KEY = 'menu-item'

let lastTile: Element | null = null

export function initMenuItem(): void {
  document.addEventListener(
    'mousedown',
    (event) => {
      try {
        const target = event.target
        if (!(target instanceof Element)) return
        const menu = target.closest('ytd-menu-renderer')
        if (!menu) return
        lastTile = closestTile(menu)
      } catch (error) {
        log.debug('menu host tracking failed', error)
      }
    },
    true,
  )
}

/** Called on every DOM settle. Cheap when the menu is closed. */
export function injectMenuItem(): void {
  try {
    const popup = pickQuiet('menuPopup')
    if (!popup) return

    // Not a video tile menu (account menu, playlist menu, ...): leave it alone.
    if (!lastTile) return

    const list = pickQuiet('menuList', popup)
    if (!list) return
    if (list.querySelector(`[data-v2f~="${ITEM_KEY}"]`)) return

    const meta = metaFromTile(lastTile)
    if (!meta) return

    const item = buildItem(meta)
    list.append(item)
  } catch (error) {
    log.error('menu item injection failed', error)
  }
}

function buildItem(meta: VideoMeta): HTMLElement {
  const icon = el('span', { class: 'v2f-menu-item__icon' })
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
  </svg>`

  const item = el('div', {
    class: 'v2f-menu-item',
    role: 'menuitem',
    tabindex: '0',
  }, [icon, el('span', {}, ['Share with friends'])])

  claim(item, ITEM_KEY)
  item.style.setProperty('--v2f-accent', BRAND.accent)

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
