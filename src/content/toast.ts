/**
 * The small dark notification at the bottom left, matching YouTube's own.
 * Used for "Sent to Henri" and for the undo after dismissing a card.
 */
import { el } from './dom'

let currentToast: HTMLElement | null = null
let timer: number | undefined

export interface ToastOptions {
  message: string
  /** Optional button, e.g. UNDO. Returning nothing closes the toast. */
  action?: { label: string; onClick: () => void }
  durationMs?: number
}

export function showToast({ message, action, durationMs = 6000 }: ToastOptions): void {
  hideToast()

  const toast = el('div', { class: 'v2f-toast', role: 'status', 'data-v2f': 'toast' }, [
    el('span', { class: 'v2f-toast__text' }, [message]),
  ])

  if (action) {
    const button = el('button', { class: 'v2f-toast__action', type: 'button' }, [action.label])
    button.addEventListener('click', () => {
      hideToast()
      action.onClick()
    })
    toast.append(button)
  }

  document.body.append(toast)
  currentToast = toast
  timer = window.setTimeout(hideToast, durationMs)
}

export function hideToast(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  currentToast?.remove()
  currentToast = null
}
