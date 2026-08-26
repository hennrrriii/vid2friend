/**
 * Handles the personal invite link: https://www.youtube.com/?v2f=ABCD2345
 *
 * Why a YouTube URL and not our own website: we do not host one. A link into
 * youtube.com works for the recipient either way - with the extension they get
 * this prompt, without it they just land on YouTube and nothing looks broken.
 *
 * `#v2f=CODE` is accepted as well, as a hedge against YouTube one day stripping
 * unknown query parameters.
 */
import { send } from '@/shared/messages'
import { BRAND, logoMarkSvg } from '@/shared/brand'
import { log } from '@/shared/log'
import { showToast } from './toast'

const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/

export async function checkConnectLink(): Promise<void> {
  try {
    const code = readCode()
    if (!code) return
    log.info('invite code found:', code)

    // Take the parameter out of the URL first, so a refresh does not ask again
    // and the code does not stay in the address bar.
    stripCode()

    const profile = await send({ type: 'friend:lookupCode', code }).catch(() => null)

    const confirmed = await confirmDialog(
      profile
        ? `${profile.username} wants to connect with you on vid2friend.`
        : `Someone shared their vid2friend code with you: ${code}`,
      profile?.avatar_color ?? BRAND.primary,
      profile?.username ?? null,
    )
    if (!confirmed) return

    await send({ type: 'friend:requestByCode', code })
    showToast({
      message: profile
        ? `Friend request sent to ${profile.username}`
        : 'Friend request sent',
    })
  } catch (error) {
    showToast({
      message: error instanceof Error ? error.message : 'Could not send the friend request.',
    })
    log.debug('connect link failed', error)
  }
}

/**
 * Looks for the code in three places, in this order.
 *
 * The third one is the important one. The content script runs at
 * document_idle, and YouTube's app rewrites the address bar during startup, so
 * by the time we look, `?v2f=` can already be gone from `location`. The
 * navigation timing entry still remembers the URL the document was actually
 * loaded with, which survives any number of history.replaceState calls.
 */
function readCode(): string | null {
  const urls: string[] = [location.href]

  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.name) urls.push(nav.name)
  } catch {
    /* navigation timing is not available; the two above will have to do */
  }

  for (const href of urls) {
    try {
      const url = new URL(href, location.origin)
      const fromQuery = url.searchParams.get('v2f')
      const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('v2f')
      const candidate = (fromQuery ?? fromHash ?? '').trim().toUpperCase()
      if (CODE_PATTERN.test(candidate)) return candidate
    } catch {
      /* not a parseable URL, try the next candidate */
    }
  }

  return null
}

function stripCode(): void {
  try {
    const url = new URL(location.href)
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
          position: fixed; inset: 0; z-index: 9999;
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
        .yes:hover { background: #1b4fa5; }
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
