/**
 * Decides when a recommendation counts as watched.
 *
 * The rule from the spec: 60% of the runtime OR three continuous minutes,
 * whichever comes first. Both halves matter. Percentage alone would mean a four
 * hour stream counts as watched after 2.4 hours (fine) but a 30 second short
 * needs 18 seconds (also fine) - while a fixed three minutes alone would mark a
 * four hour stream watched after two minutes, and a 30 second short never.
 *
 * Time is counted cumulatively from `timeupdate` deltas, not from the playhead
 * position. Dragging the scrubber to the end therefore does not mark anything
 * watched, which is exactly what the sender would expect.
 */
import { pickQuiet, videoIdFromUrl } from './dom'
import { getState, refresh } from './state'
import { send } from '@/shared/messages'
import { log } from '@/shared/log'

const CONTINUOUS_SECONDS = 180
const FRACTION = 0.6
/** A jump larger than this is a seek, not playback, and is not counted. */
const MAX_TICK_SECONDS = 2

interface Tracking {
  videoId: string
  shareId: string
  video: HTMLVideoElement
  watchedSeconds: number
  lastPosition: number
  reported: boolean
  onTimeUpdate: () => void
}

let tracking: Tracking | null = null

/** Called on every navigation. Attaches, re-attaches or detaches as needed. */
export function syncWatchTracker(): void {
  try {
    const videoId = location.pathname === '/watch' ? videoIdFromUrl(location.href) : null

    if (!videoId) {
      detach()
      return
    }
    if (tracking?.videoId === videoId && tracking.video.isConnected) return

    const match = getState().openShares.find((entry) => entry.videoId === videoId)
    if (!match) {
      // Not one of our recommendations. Nothing to track.
      detach()
      return
    }

    const video = pickQuiet('videoElement') as HTMLVideoElement | null
    if (!video) return // player not in the DOM yet; the next tick will retry

    detach()
    attach(match.shareId, videoId, video)
  } catch (error) {
    log.error('watch tracker sync failed', error)
  }
}

function attach(shareId: string, videoId: string, video: HTMLVideoElement): void {
  const state: Tracking = {
    videoId,
    shareId,
    video,
    watchedSeconds: 0,
    lastPosition: video.currentTime,
    reported: false,
    onTimeUpdate: () => {},
  }

  state.onTimeUpdate = () => {
    const position = video.currentTime
    const delta = position - state.lastPosition
    state.lastPosition = position

    // Only forward playback within one tick counts. Seeks, loops and rewinds
    // produce a delta outside this window and are ignored.
    if (delta > 0 && delta <= MAX_TICK_SECONDS) {
      state.watchedSeconds += delta
    }

    if (state.reported) return

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const threshold = duration
      ? Math.min(duration * FRACTION, CONTINUOUS_SECONDS)
      : CONTINUOUS_SECONDS

    if (state.watchedSeconds >= threshold) {
      state.reported = true
      log.info(`watched ${Math.round(state.watchedSeconds)}s, marking as watched`)
      void send({ type: 'share:watched', shareId: state.shareId })
        .then(() => refresh())
        .catch((error) => log.debug('could not mark watched', error))
    }
  }

  video.addEventListener('timeupdate', state.onTimeUpdate)
  tracking = state
  log.debug('tracking watch progress for', videoId)
}

function detach(): void {
  if (!tracking) return
  tracking.video.removeEventListener('timeupdate', tracking.onTimeUpdate)
  tracking = null
}
