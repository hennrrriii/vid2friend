/**
 * Captures the invite code from the URL, at `document_start`.
 *
 * This is a separate content script for one reason: timing. The main content
 * script runs at `document_idle`, which is after YouTube's app has booted and
 * rewritten the address bar. By then `?v2f=CODE` can simply be gone, and no
 * amount of reading `location` afterwards brings it back. Reading the
 * navigation timing entry instead helps only when nothing redirected.
 *
 * At `document_start` nothing has run yet, so `location` is still exactly the
 * URL the user opened. We stash the code and let the main script deal with the
 * user interface once it is up.
 *
 * Keep this file tiny and dependency free. It runs before YouTube's own
 * JavaScript on every single page load, so it has no business doing anything
 * that could take time or throw.
 */

const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/
const PENDING_KEY = 'v2f-pending-invite'

try {
  const fromQuery = new URLSearchParams(location.search).get('v2f')
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('v2f')
  const code = (fromQuery ?? fromHash ?? '').trim().toUpperCase()

  if (CODE_PATTERN.test(code)) {
    // Deliberately not awaited and deliberately not stripping the URL here.
    // Stripping this early would mean rewriting the address bar while YouTube
    // is still reading it; the main script does that once the page is up.
    void chrome.storage.local.set({ [PENDING_KEY]: { code, at: Date.now() } })
    console.info('[vid2friend] invite code captured:', code)
  }
} catch (error) {
  console.warn('[vid2friend] invite capture failed', error)
}
