/**
 * The row of friend recommendations at the top of the YouTube homepage.
 *
 * Two things this must never do, both straight from the spec:
 *   - render a placeholder. Two recommendations means two cards. Zero
 *     recommendations means the whole shelf is removed and the homepage looks
 *     exactly like it always does.
 *   - touch the normal feed. We insert one node above it and nothing else.
 */
import { alreadyInjected, claim, el, formatDuration, isVideoId, pick, thumbnailUrl } from './dom'
import { getState, onStateChange, refresh } from './state'
import { showToast } from './toast'
import { send } from '@/shared/messages'
import { logoMarkSvg } from '@/shared/brand'
import { log } from '@/shared/log'
import type { CachedState, ShelfItem } from '@/shared/types'

const SHELF_KEY = 'shelf'
const MIN_CARD_WIDTH = 320

export function initShelf(): void {
  onStateChange(render)
  // Registered exactly once. The shelf itself is rebuilt whenever its contents
  // change, so attaching this inside buildShelf would pile up listeners on
  // window for the lifetime of the tab.
  window.addEventListener('resize', handleResize, { passive: true })
  render(getState())
}

function handleResize(): void {
  const shelf = document.querySelector<HTMLElement>(`[data-v2f~="${SHELF_KEY}"]`)
  if (!shelf) return
  updateColumns(shelf)
  const viewport = shelf.querySelector<HTMLElement>('.v2f-shelf__viewport')
  const track = shelf.querySelector<HTMLElement>('.v2f-shelf__track')
  if (viewport && track) updateArrows(viewport, track)
}

/** Called on every navigation and on every state change. Cheap and idempotent. */
export function render(state: CachedState = getState()): void {
  try {
    if (!isHomepage()) {
      removeShelf()
      return
    }
    if (state.paused || state.shelf.length === 0) {
      removeShelf()
      return
    }

    const existing = document.querySelector<HTMLElement>(`[data-v2f~="${SHELF_KEY}"]`)
    if (existing) {
      // Same data, same DOM: do not rebuild while the user might be hovering.
      if (existing.dataset.v2fSignature === signature(state)) return
      existing.remove()
    }

    const contents = pick('homeContents')
    if (!contents) return

    const shelf = buildShelf(state)
    shelf.dataset.v2fSignature = signature(state)

    const firstRow = contents.firstElementChild
    if (firstRow) contents.insertBefore(shelf, firstRow)
    else contents.append(shelf)

    updateColumns(shelf)
  } catch (error) {
    // A broken shelf must never take the homepage with it.
    log.error('shelf render failed', error)
  }
}

function isHomepage(): boolean {
  return location.pathname === '/' || location.pathname === '/index'
}

function removeShelf(): void {
  document.querySelectorAll(`[data-v2f~="${SHELF_KEY}"]`).forEach((node) => node.remove())
}

/** Cheap fingerprint of what is on screen, so we only rebuild when it changed. */
function signature(state: CachedState): string {
  return state.shelf
    .map((item) => `${item.share.id}:${item.share.slot_position}`)
    .join('|')
}

function buildShelf(state: CachedState): HTMLElement {
  const shelf = el('div', { class: 'v2f-shelf' })
  claim(shelf, SHELF_KEY)

  // --- header ---
  const logo = el('span', { class: 'v2f-shelf__logo' })
  logo.innerHTML = logoMarkSvg(24)

  const openPopup = el('button', { class: 'v2f-shelf__link', type: 'button' }, ['See all'])
  openPopup.addEventListener('click', () => {
    void send({ type: 'openPopup' }).catch(() =>
      showToast({ message: 'Open vid2friend from the toolbar icon.' }),
    )
  })

  shelf.append(
    el('div', { class: 'v2f-shelf__header' }, [
      logo,
      el('h2', { class: 'v2f-shelf__title' }, ['From your friends']),
      el('span', { class: 'v2f-shelf__spacer' }),
      openPopup,
    ]),
  )

  // --- track ---
  const track = el('div', { class: 'v2f-shelf__track' })
  for (const item of state.shelf) {
    const card = buildCard(item)
    if (card) track.append(card)
  }

  const viewport = el('div', { class: 'v2f-shelf__viewport' }, [
    arrowButton('prev', track),
    track,
    arrowButton('next', track),
  ])
  shelf.append(viewport)

  track.addEventListener('scroll', () => updateArrows(viewport, track), { passive: true })
  // Wait a frame so the browser has laid the track out before measuring it.
  requestAnimationFrame(() => updateArrows(viewport, track))

  return shelf
}

function buildCard(item: ShelfItem): HTMLElement | null {
  const { share, sender } = item
  if (!isVideoId(share.video_id)) return null

  const thumb = el('div', { class: 'v2f-card__thumb' }, [
    el('img', {
      src: thumbnailUrl(share.video_id),
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    }),
  ])

  const duration = formatDuration(share.duration_seconds)
  if (duration) {
    thumb.append(el('span', { class: 'v2f-card__duration' }, [duration]))
  }

  const meta = el('div', { class: 'v2f-card__meta' }, [
    el('h3', { class: 'v2f-card__title', title: share.video_title ?? '' }, [
      share.video_title ?? 'Untitled video',
    ]),
    el('div', { class: 'v2f-card__by' }, [`Suggested by ${sender.username}`]),
  ])

  if (share.channel_name) {
    meta.append(el('div', { class: 'v2f-card__channel' }, [share.channel_name]))
  }
  if (share.note) {
    meta.append(el('div', { class: 'v2f-card__note' }, [`"${share.note}"`]))
  }

  const avatar = el('div', { class: 'v2f-card__avatar' }, [
    sender.username.slice(0, 1).toUpperCase(),
  ])
  avatar.style.backgroundColor = sender.avatar_color

  const link = el(
    'a',
    {
      class: 'v2f-card__link',
      href: `/watch?v=${share.video_id}`,
      // No target: staying in the SPA is what YouTube's own cards do, and it
      // keeps the watch tracker attached.
    },
    [thumb, el('div', { class: 'v2f-card__body' }, [avatar, meta])],
  )

  const card = el('div', { class: 'v2f-card', 'data-v2f-share': share.id }, [link, dismissButton(item)])
  return card
}

function dismissButton(item: ShelfItem): HTMLElement {
  const button = el(
    'button',
    {
      class: 'v2f-card__dismiss',
      type: 'button',
      title: 'Not interested',
      'aria-label': `Dismiss the video ${item.share.video_title ?? ''} from ${item.sender.username}`,
    },
    [],
  )
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void dismiss(item)
  })

  return button
}

async function dismiss(item: ShelfItem): Promise<void> {
  // Optimistic: the card goes immediately, the server catches up.
  document.querySelector(`[data-v2f-share="${item.share.id}"]`)?.remove()

  try {
    await send({ type: 'share:dismiss', shareId: item.share.id })
    showToast({
      message: `Removed the video from ${item.sender.username}`,
      action: {
        label: 'Undo',
        onClick: () => {
          void send({ type: 'share:undismiss', shareId: item.share.id })
            .then(() => refresh())
            .catch((error) => showToast({ message: String(error) }))
        },
      },
    })
  } catch (error) {
    showToast({ message: error instanceof Error ? error.message : 'Could not remove that.' })
    void refresh()
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Mirrors how YouTube picks its column count: as many columns as fit at roughly
 * 320px each, capped at six because that is the most slots we can ever have.
 */
function updateColumns(shelf: HTMLElement): void {
  const width = shelf.clientWidth || document.documentElement.clientWidth
  const columns = Math.min(6, Math.max(1, Math.floor(width / MIN_CARD_WIDTH)))
  shelf.style.setProperty('--v2f-cols', String(columns))
}

function arrowButton(direction: 'prev' | 'next', track: HTMLElement): HTMLElement {
  const button = el('button', {
    class: `v2f-shelf__arrow v2f-shelf__arrow--${direction}`,
    type: 'button',
    'aria-label': direction === 'prev' ? 'Scroll left' : 'Scroll right',
  })
  button.innerHTML =
    direction === 'prev'
      ? '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'

  button.addEventListener('click', () => {
    track.scrollBy({ left: direction === 'prev' ? -track.clientWidth : track.clientWidth })
  })

  return button
}

function updateArrows(viewport: HTMLElement, track: HTMLElement): void {
  const prev = viewport.querySelector<HTMLElement>('.v2f-shelf__arrow--prev')
  const next = viewport.querySelector<HTMLElement>('.v2f-shelf__arrow--next')
  const maxScroll = track.scrollWidth - track.clientWidth

  if (prev) prev.dataset.enabled = track.scrollLeft > 8 ? '1' : '0'
  if (next) next.dataset.enabled = track.scrollLeft < maxScroll - 8 ? '1' : '0'
}

/** Exported for the orchestrator: has the shelf been put on the page already. */
export function shelfPresent(): boolean {
  return alreadyInjected(SHELF_KEY)
}
