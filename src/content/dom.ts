/**
 * Small DOM helpers shared by every content script module.
 *
 * The contract for all of them: they never throw, and they never leave YouTube
 * in a worse state than they found it. A missing element is a normal outcome,
 * not an exception.
 */
import { SELECTORS, type SelectorKey } from './selectors'
import { log, warnOnce } from '@/shared/log'

/** First element matching any of the fallback selectors for `key`. */
export function pick(key: SelectorKey, root: ParentNode = document): Element | null {
  for (const selector of SELECTORS[key]) {
    try {
      const found = root.querySelector(selector)
      if (found) return found
    } catch (error) {
      log.debug('bad selector', selector, error)
    }
  }
  warnOnce(
    `selector:${key}`,
    `no element matched "${key}". YouTube probably changed its DOM. See src/content/selectors.ts for how to fix this.`,
  )
  return null
}

/** Like pick(), but quiet - for things that are legitimately absent sometimes. */
export function pickQuiet(key: SelectorKey, root: ParentNode = document): Element | null {
  for (const selector of SELECTORS[key]) {
    try {
      const found = root.querySelector(selector)
      if (found) return found
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Nearest ancestor (including self) that is a video tile of any kind. */
export function closestTile(node: Element | null): Element | null {
  if (!node) return null
  const selector = SELECTORS.videoTile.join(',')
  try {
    return node.closest(selector)
  } catch {
    return null
  }
}

/** Text content of the first matching element, trimmed, or null. */
export function textOf(key: SelectorKey, root: ParentNode): string | null {
  const element = pickQuiet(key, root)
  const text = element?.textContent?.trim()
  return text && text.length > 0 ? text : null
}

/**
 * Marks an element as ours and returns false if it was already marked.
 * This is what keeps injection idempotent: YouTube re-renders parts of the page
 * constantly, and every inject function calls this first.
 */
export function claim(element: Element, key: string): boolean {
  const attribute = 'data-v2f'
  const existing = element.getAttribute(attribute)
  if (existing?.split(' ').includes(key)) return false
  element.setAttribute(attribute, existing ? `${existing} ${key}` : key)
  return true
}

/** True if an element with this data-v2f marker already exists in `root`. */
export function alreadyInjected(key: string, root: ParentNode = document): boolean {
  return root.querySelector(`[data-v2f~="${key}"]`) !== null
}

/** "12:03" or "1:02:03" or "0:19" to seconds. Returns null for live badges. */
export function parseDuration(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.trim()
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(cleaned)) return null
  const parts = cleaned.split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** Seconds to the "12:03" form YouTube uses on thumbnails. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Extracts an 11 character YouTube id from any URL shape we might see. */
export function videoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url, location.origin)
    const fromQuery = parsed.searchParams.get('v')
    if (fromQuery && isVideoId(fromQuery)) return fromQuery

    // /shorts/<id>, /embed/<id>, /live/<id>
    const match = parsed.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)
    if (match?.[1]) return match[1]

    // youtu.be/<id>
    if (parsed.hostname.endsWith('youtu.be')) {
      const id = parsed.pathname.slice(1, 12)
      if (isVideoId(id)) return id
    }
  } catch {
    /* not a URL */
  }
  return null
}

export function isVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value)
}

export function thumbnailUrl(videoId: string): string {
  // hqdefault always exists, including for very old videos. No API key needed,
  // which is the whole reason we scrape metadata from the DOM in the first place.
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/**
 * Runs `fn` on every YouTube navigation and whenever the DOM settles.
 *
 * YouTube is a single page app: `yt-navigate-finish` covers in-app navigation,
 * and the MutationObserver is the safety net for content that streams in
 * afterwards. The observer is debounced because YouTube mutates the DOM
 * hundreds of times per second while a feed is loading.
 */
export function onPageChange(fn: () => void): void {
  let timer: number | undefined
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        fn()
      } catch (error) {
        log.error('page change handler failed', error)
      }
    }, 150)
  }

  document.addEventListener('yt-navigate-finish', schedule)
  document.addEventListener('yt-page-data-updated', schedule)
  window.addEventListener('popstate', schedule)

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  schedule()
}

/** True when YouTube is in dark mode. */
export function isDarkMode(): boolean {
  return document.documentElement.hasAttribute('dark')
}

/** Builds an element in one call, so the inject functions stay readable. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') node.className = value
    else node.setAttribute(name, value)
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}
