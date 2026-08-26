/**
 * The "Share with friends" pill on the watch page, sitting to the left of the
 * Like button. Same shape and height as YouTube's own Share and Save buttons,
 * and it collapses to icon only on narrow windows the way they do.
 */
import { claim, el, pick, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { openShareModal } from './share-modal'
import { logoMarkSvg } from '@/shared/brand'
import { log } from '@/shared/log'
import type { VideoMeta } from '@/shared/types'

const BUTTON_KEY = 'watch-button'

export function injectWatchButton(): void {
  try {
    if (location.pathname !== '/watch') return

    const bar = pick('watchActionBar')
    if (!bar) return
    if (bar.querySelector(`[data-v2f~="${BUTTON_KEY}"]`)) return

    const button = buildButton()
    // Left of the like/dislike segment, per the spec.
    bar.prepend(button)
  } catch (error) {
    log.error('watch button injection failed', error)
  }
}

function buildButton(): HTMLElement {
  // The brand mark rather than a generic icon. This button sits among Like,
  // Share and Save, all of which look the same; the logo plus the filled blue
  // is what makes it findable as ours at a glance.
  const icon = document.createElement('span')
  icon.className = 'v2f-watch-button__icon'
  icon.innerHTML = logoMarkSvg(20)

  const button = el(
    'button',
    { class: 'v2f-watch-button', type: 'button', title: 'Share with friends on vid2friend' },
    [icon, el('span', { class: 'v2f-watch-button__label' }, ['Share with friends'])],
  )
  claim(button, BUTTON_KEY)

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const meta = metaFromWatchPage()
    if (!meta) return
    void openShareModal(meta)
  })

  return button
}

/** Reads the current watch page. Duration comes from the player, not the DOM. */
export function metaFromWatchPage(): VideoMeta | null {
  const videoId = videoIdFromUrl(location.href)
  if (!videoId) return null

  const video = pickQuiet('videoElement') as HTMLVideoElement | null
  const duration =
    video && Number.isFinite(video.duration) && video.duration > 0
      ? Math.round(video.duration)
      : null

  return {
    videoId,
    title: textOf('watchTitle', document) ?? document.title.replace(/ - YouTube$/, ''),
    channelName: textOf('watchChannel', document),
    durationSeconds: duration,
  }
}
