/**
 * The "Share with friends" pill on the watch page, sitting to the left of the
 * Like button. Same shape and height as YouTube's own Share and Save buttons,
 * and it collapses to icon only on narrow windows the way they do.
 */
import { claim, el, pick, pickQuiet, textOf, videoIdFromUrl } from './dom'
import { openShareModal } from './share-modal'
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
  const icon = document.createElement('span')
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
  </svg>`
  icon.style.lineHeight = '0'

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
