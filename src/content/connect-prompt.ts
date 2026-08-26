/**
 * Handles the personal invite link: https://www.youtube.com/?v2f=ABCD2345
 *
 * Why a YouTube URL and not our own website: we do not host one. A link into
 * youtube.com works for the recipient either way - with the extension they get
 * this prompt, without it they just land on YouTube and nothing looks broken.
 *
 * The code itself is NOT read here. It is captured at document_start by
 * invite-capture.ts and left in chrome.storage, because by the time this file
 * runs the parameter may already be gone from the address bar. This module only
 * picks it up, asks, and clears it.
 *
 * Leaving it in storage until the user answers has a useful side effect: if
 * they follow an invite link before setting up their own profile, the request
 * is not lost. The prompt comes back on the next YouTube page load, once
 * vid2friend actually has an account to send it from.
 */
import { send } from '@/shared/messages'
import { BRAND, logoMarkSvg } from '@/shared/brand'
import { log } from '@/shared/log'
import { showToast } from './toast'

const PENDING_KEY = 'v2f-pending-invite'
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/
/** A code nobody acted on within this window is stale. */
const MAX_AGE_MS = 30 * 60 * 1000

interface PendingInvite {
  code: string
  at: number
}

export async function checkConnectLink(): Promise<void> {
  try {
    const code = await pendingCode()
    if (!code) return

    log.info('invite code pending:', code)
    stripCodeFromUrl()

    const profile = await send({ type: 'friend:lookupCode', code }).catch(() => null)

    const confirmed = await confirmDialog(
      profile
        ? `${profile.username} wants to connect with you on vid2friend.`
        : `Someone shared their vid2friend code with you: ${code}`,
      profile?.avatar_color ?? BRAND.primary,
      profile?.username ?? null,
    )

    if (!confirmed) {
      await clearPending()
      return
    }

    await send({ type: 'friend:requestByCode', code })
    await clearPending()

    showToast({
      message: profile ? `Friend request sent to ${profile.username}` : 'Friend request sent',
    })
  } catch (error) {
    // The code stays in storage on failure, so setting up a profile and
    // reloading YouTube is enough to get the prompt back.
    showToast({
      message: error instanceof Error ? error.message : 'Could not send the friend request.',
    })
    log.debug('connect link failed', error)
  }
}

/**
 * The code invite-capture.ts stashed, or, as a fallback, one still in the URL.
 * The fallback matters for a soft navigation, where document_start never fires.
 */
async function pendingCode(): Promise<string | null> {
  try {
    const stored = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as
      | PendingInvite
      | undefined

    if (stored && CODE_PATTERN.test(stored.code)) {
      if (Date.now() - stored.at < MAX_AGE_MS) return stored.code
      await clearPending()
    }
  } catch (error) {
    log.debug('could not read the pending invite', error)
  }

  const fromQuery = new URLSearchParams(location.search).get('v2f')
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('v2f')
  const candidate = (fromQuery ?? fromHash ?? '').trim().toUpperCase()
  return CODE_PATTERN.test(candidate) ? candidate : null
}

async function clearPending(): Promise<void> {
  try {
    await chrome.storage.local.remove(PENDING_KEY)
  } catch (error) {
    log.debug('could not clear the pending invite', error)
  }
}

function stripCodeFromUrl(): void {
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has('v2f') && !url.hash.includes('v2f=')) return
    url.searchParams.delete('v2f')
    if (url.hash.includes('v2f=')) url.hash = ''
    history.replaceState(null, '', url.toString())
  } catch (error) {
    log.debug('could not clean the URL', error)
  }
}

/** A small confirm dialog in its own shadow root, styled like the share modal. */
function confirmDialog(
  message: string,
  accentColor: string,
  username: string | null,
): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-v2f', 'connect')
    const shadow = host.attachShadow({ mode: 'open' })

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: 'Roboto', system-ui, sans-serif; }
        .overlay {
          position: fixed; inset: 0; z-index: 2147483000;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0, 0, 0, 0.6);
        }
        .card {
          width: min(400px, calc(100vw - 32px));
          padding: 20px; border-radius: 12px;
          background: #14161a; color: #e9ecf1;
          font-size: 14px; line-height: 1.5;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
          text-align: center;
        }
        .logo { display: flex; justify-content: center; margin-bottom: 12px; }
        .avatar {
          width: 48px; height: 48px; border-radius: 50%; margin: 0 auto 12px;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 20px; font-weight: 500;
        }
        p { margin: 0 0 18px; }
        .row { display: flex; gap: 8px; }
        button {
          flex: 1; padding: 10px; border: 0; border-radius: 8px;
          font-size: 14px; font-weight: 500; cursor: pointer;
        }
        .no { background: #23262e; color: #e9ecf1; }
        .yes { background: ${BRAND.primary}; color: #fff; }
        .yes:hover { background: ${BRAND.primaryDark}; }
        :focus-visible { outline: 2px solid ${BRAND.accent}; outline-offset: 2px; }
      </style>
      <div class="overlay">
        <div class="card" role="dialog" aria-modal="true">
          ${
            username
              ? `<div class="avatar" style="background:${accentColor}">${username
                  .slice(0, 1)
                  .toUpperCase()}</div>`
              : `<div class="logo">${logoMarkSvg(40)}</div>`
          }
          <p>${message}</p>
          <div class="row">
            <button class="no" type="button">Not now</button>
            <button class="yes" type="button">Add friend</button>
          </div>
        </div>
      </div>`

    // Keystrokes must not reach YouTube's global shortcut handlers. See the
    // comment on containKeyEvents in share-modal.ts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      host.addEventListener(type, (event) => event.stopPropagation())
    }

    document.body.append(host)

    const finish = (result: boolean) => {
      host.remove()
      resolve(result)
    }

    shadow.querySelector('.yes')?.addEventListener('click', () => finish(true))
    shadow.querySelector('.no')?.addEventListener('click', () => finish(false))
    shadow.querySelector('.overlay')?.addEventListener('mousedown', (event) => {
      if (event.target === shadow.querySelector('.overlay')) finish(false)
    })
    shadow.querySelector<HTMLElement>('.yes')?.focus()
  })
}
