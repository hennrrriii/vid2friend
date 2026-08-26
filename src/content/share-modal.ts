/**
 * The "Share with friends" dialog.
 *
 * This one DOES use Shadow DOM, unlike the shelf. The shelf wants to inherit
 * YouTube's fonts and theme variables so it disappears into the page; the modal
 * wants the opposite, because YouTube's global styles for buttons, inputs and
 * dialogs would fight it the whole way.
 */
import { BRAND, logoMarkSvg } from '@/shared/brand'
import { send } from '@/shared/messages'
import { log } from '@/shared/log'
import type { Friend, VideoMeta } from '@/shared/types'
import { showToast } from './toast'
import { thumbnailUrl } from './dom'

const HOST_ID = 'v2f-share-modal'
const NOTE_LIMIT = 140

let host: HTMLElement | null = null
let lastFocused: Element | null = null

export async function openShareModal(meta: VideoMeta): Promise<void> {
  closeShareModal()
  lastFocused = document.activeElement

  host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('data-v2f', 'modal')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(styleElement())
  containKeyEvents(host)
  document.body.append(host)

  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.innerHTML = shellHtml(meta)
  shadow.append(overlay)

  const dialog = overlay.querySelector<HTMLElement>('.dialog')
  if (!dialog) return

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeShareModal()
  })
  document.addEventListener('keydown', onKeydown, true)

  wireNoteCounter(dialog)
  dialog.querySelector<HTMLElement>('.close')?.addEventListener('click', closeShareModal)

  await populateFriends(dialog, meta)
}

export function closeShareModal(): void {
  document.removeEventListener('keydown', onKeydown, true)
  host?.remove()
  host = null
  if (lastFocused instanceof HTMLElement) lastFocused.focus()
  lastFocused = null
}

export function isShareModalOpen(): boolean {
  return host !== null
}

// ---------------------------------------------------------------------------

/**
 * Stops keystrokes inside the dialog from reaching YouTube.
 *
 * Shadow DOM isolates styles, not events. Worse: when an event crosses the
 * shadow boundary it is retargeted, so YouTube's document level shortcut
 * handlers see `event.target` as our host <div> rather than an <input>. Their
 * usual "ignore this, the user is typing" check therefore does not fire, and
 * typing a note would seek the video, mute it and open the caption menu.
 *
 * Listening on the host in the bubble phase is the right place: the event has
 * already reached our input, and it stops before it ever gets to document.
 */
function containKeyEvents(element: HTMLElement): void {
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    element.addEventListener(type, (event) => event.stopPropagation())
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!host) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeShareModal()
    return
  }

  // Focus trap. Without it, Tab walks straight out of the dialog into the
  // YouTube page behind it, which for a keyboard user means the dialog is gone.
  if (event.key !== 'Tab') return
  const shadow = host.shadowRoot
  if (!shadow) return

  const focusable = [
    ...shadow.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element === shadow.activeElement)

  if (focusable.length === 0) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = shadow.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function wireNoteCounter(dialog: HTMLElement): void {
  const note = dialog.querySelector<HTMLTextAreaElement>('.note')
  const counter = dialog.querySelector<HTMLElement>('.counter')
  note?.addEventListener('input', () => {
    if (counter) counter.textContent = `${note.value.length}/${NOTE_LIMIT}`
  })
}

/** Above this many friends the list stops being scannable and gets a filter. */
const FILTER_THRESHOLD = 10

async function populateFriends(dialog: HTMLElement, meta: VideoMeta): Promise<void> {
  const list = dialog.querySelector<HTMLElement>('.friends')
  const searchSlot = dialog.querySelector<HTMLElement>('.search-slot')
  const submit = dialog.querySelector<HTMLButtonElement>('.submit')
  if (!list || !submit) return

  let friends: Friend[] = []
  try {
    friends = (await send({ type: 'friends:list' })).filter((f) => f.status === 'accepted')
  } catch (error) {
    list.innerHTML = `<p class="empty">${escapeHtml(
      error instanceof Error ? error.message : 'Could not load your friends.',
    )}</p>`
    return
  }

  if (friends.length === 0) {
    list.innerHTML =
      '<p class="empty">No friends yet. Open vid2friend from the toolbar and share your friend code.</p>'
    submit.disabled = true
    return
  }

  // A quiet hint, not a blocker: they might still want to send it again.
  let alreadyQueued: string[] = []
  try {
    alreadyQueued = await send({
      type: 'friends:alreadyQueued',
      videoId: meta.videoId,
      friendIds: friends.map((f) => f.profile.id),
    })
  } catch (error) {
    log.debug('already-queued hint unavailable', error)
  }

  const selected = new Set<string>()

  const syncSubmit = () => {
    submit.disabled = selected.size === 0
    submit.textContent = selected.size > 1 ? `Share with ${selected.size}` : 'Share'
  }

  const draw = (filter: string) => {
    const needle = filter.trim().toLowerCase()
    const visible = needle
      ? friends.filter((f) => f.profile.username.toLowerCase().includes(needle))
      : friends

    if (visible.length === 0) {
      list.innerHTML = '<p class="empty">No friend matches that.</p>'
      return
    }

    // Rows are buttons, not checkboxes in labels. Clicking anywhere on the row
    // toggles it, and there is nothing here that wants keyboard input.
    list.innerHTML = visible
      .map((friend) => {
        const queued = alreadyQueued.includes(friend.profile.id)
        const on = selected.has(friend.profile.id)
        return `
          <button type="button" class="friend${on ? ' is-selected' : ''}"
                  data-id="${escapeHtml(friend.profile.id)}" aria-pressed="${on}">
            <span class="avatar" style="background:${escapeHtml(friend.profile.avatar_color)}">${escapeHtml(
              friend.profile.username.slice(0, 1).toUpperCase(),
            )}</span>
            <span class="name">${escapeHtml(friend.profile.username)}</span>
            ${queued ? '<span class="hint">already waiting</span>' : ''}
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </span>
          </button>`
      })
      .join('')

    list.querySelectorAll<HTMLButtonElement>('.friend').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.id
        if (!id) return
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        row.classList.toggle('is-selected', selected.has(id))
        row.setAttribute('aria-pressed', String(selected.has(id)))
        syncSubmit()
      })
    })
  }

  // Only worth a search box once scanning the list stops being faster.
  if (friends.length > FILTER_THRESHOLD && searchSlot) {
    const search = document.createElement('input')
    search.className = 'search'
    search.type = 'search'
    search.placeholder = 'Filter friends'
    search.setAttribute('aria-label', 'Filter friends')
    search.addEventListener('input', () => draw(search.value))
    searchSlot.append(search)
  }

  draw('')
  syncSubmit()

  submit.addEventListener('click', () => {
    void doShare(dialog, meta, [...selected], friends)
  })
}

async function doShare(
  dialog: HTMLElement,
  meta: VideoMeta,
  recipientIds: string[],
  friends: Friend[],
): Promise<void> {
  const submit = dialog.querySelector<HTMLButtonElement>('.submit')
  const note = dialog.querySelector<HTMLTextAreaElement>('.note')
  const error = dialog.querySelector<HTMLElement>('.error')
  if (!submit) return

  submit.disabled = true
  submit.textContent = 'Sending...'
  if (error) error.textContent = ''

  try {
    const outcomes = await send({
      type: 'share:create',
      recipientIds,
      meta,
      note: note?.value.trim() || null,
    })

    const failed = outcomes.filter((o) => !o.ok)
    const sent = outcomes.filter((o) => o.ok)

    if (sent.length > 0) {
      closeShareModal()
      showToast({ message: describeSuccess(sent, friends) })
    }

    if (failed.length > 0) {
      const names = failed
        .map((f) => nameOf(f.recipientId, friends))
        .join(', ')
      const message = `${names}: ${failed[0]?.error ?? 'could not be reached'}`
      if (sent.length > 0) showToast({ message })
      else if (error) error.textContent = message
    }
  } catch (caught) {
    if (error) {
      error.textContent = caught instanceof Error ? caught.message : 'Sharing failed.'
    }
  } finally {
    submit.disabled = false
    submit.textContent = 'Share'
  }
}

/** "Sent to Henri, number 2 in his queue" - the line that explains the feature. */
function describeSuccess(
  outcomes: { recipientId: string; queuePosition?: number }[],
  friends: Friend[],
): string {
  if (outcomes.length === 1) {
    const only = outcomes[0]!
    const name = nameOf(only.recipientId, friends)
    if (only.queuePosition && only.queuePosition > 1) {
      return `Sent to ${name}, number ${only.queuePosition} in their queue`
    }
    return `Sent to ${name}, at the top of their YouTube homepage`
  }
  return `Sent to ${outcomes.length} friends`
}

function nameOf(profileId: string, friends: Friend[]): string {
  return friends.find((f) => f.profile.id === profileId)?.profile.username ?? 'your friend'
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function shellHtml(meta: VideoMeta): string {
  return `
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Share with friends">
      <header>
        <span class="logo">${logoMarkSvg(20)}</span>
        <h2>Share with friends</h2>
        <button class="close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </header>

      <div class="video">
        <img src="${thumbnailUrl(meta.videoId)}" alt="" referrerpolicy="no-referrer" />
        <div>
          <div class="video-title">${escapeHtml(meta.title ?? 'This video')}</div>
          <div class="video-channel">${escapeHtml(meta.channelName ?? '')}</div>
        </div>
      </div>

      <div class="search-slot"></div>
      <div class="friends"><p class="empty">Loading...</p></div>

      <div class="note-row">
        <textarea class="note" maxlength="${NOTE_LIMIT}" rows="2"
          placeholder="Add a note (optional)" aria-label="Note"></textarea>
        <span class="counter">0/${NOTE_LIMIT}</span>
      </div>

      <p class="error" role="alert"></p>
      <button class="submit" type="button">Share</button>
    </div>`
}

function styleElement(): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Roboto', system-ui, sans-serif; }

    .overlay {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
      display: flex; flex-direction: column; gap: 12px;
      padding: 16px;
      border-radius: 12px;
      background: #14161a; color: #e9ecf1;
      font-size: 14px; line-height: 1.45;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }

    header { display: flex; align-items: center; gap: 8px; }
    header h2 { margin: 0; flex: 1; font-size: 15px; font-weight: 600; }
    .logo { display: flex; line-height: 0; }
    .close { border: 0; background: transparent; color: #9aa3b2; cursor: pointer; padding: 4px; border-radius: 50%; }
    .close:hover { background: #23262e; color: #e9ecf1; }

    .video { display: flex; gap: 10px; align-items: center; }
    .video img { width: 96px; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; }
    .video-title { font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .video-channel { color: #9aa3b2; font-size: 12px; }

    .search {
      width: 100%; padding: 8px 10px;
      border: 1px solid #2a2e37; border-radius: 8px;
      background: #1c1f26; color: inherit; font-size: 13px;
    }
    .search:focus { outline: none; border-color: ${BRAND.accent}; }
    .search-slot:empty { display: none; }

    .friends { flex: 1 1 auto; overflow-y: auto; max-height: 220px; min-height: 60px; }
    .friend {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 9px 10px; margin-bottom: 2px;
      border: 1px solid transparent; border-radius: 8px;
      background: #1c1f26; color: inherit;
      font: inherit; font-size: 14px; text-align: left; cursor: pointer;
    }
    .friend:hover { background: #23262e; }
    .friend.is-selected { border-color: ${BRAND.primary}; background: rgba(36, 103, 212, 0.18); }
    .tick { margin-left: auto; color: ${BRAND.accent}; opacity: 0; display: flex; }
    .friend.is-selected .tick { opacity: 1; }
    .avatar {
      width: 26px; height: 26px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 12px; font-weight: 500; flex: 0 0 26px;
    }
    .name { flex: 1; }
    .hint { color: ${BRAND.accent}; font-size: 11px; }
    .empty { margin: 8px; color: #9aa3b2; font-size: 12px; }

    .note-row { position: relative; }
    .note {
      width: 100%; padding: 8px 10px; resize: vertical;
      border: 1px solid #2a2e37; border-radius: 8px;
      background: #1c1f26; color: inherit; font-size: 13px;
    }
    .note:focus { outline: none; border-color: ${BRAND.accent}; }
    .counter { position: absolute; right: 8px; bottom: 6px; color: #6d7686; font-size: 11px; }

    .error { margin: 0; min-height: 0; color: #ff8a80; font-size: 12px; }
    .error:empty { display: none; }

    .submit {
      padding: 10px; border: 0; border-radius: 8px;
      background: ${BRAND.primary}; color: #fff;
      font-size: 14px; font-weight: 500; cursor: pointer;
    }
    .submit:hover:not(:disabled) { background: #1b4fa5; }
    .submit:disabled { opacity: 0.5; cursor: default; }
    :focus-visible { outline: 2px solid ${BRAND.accent}; outline-offset: 2px; }
  `
  return style
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
