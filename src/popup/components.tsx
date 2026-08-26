/** Small shared pieces of the popup UI. Nothing clever, just less repetition. */
import type { ReactNode } from 'react'

export function Avatar({
  name,
  color,
  size = 28,
}: {
  name: string
  color: string
  size?: number
}) {
  return (
    <span
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null
  return (
    <div className="banner banner--error" role="alert">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="banner banner--info">{children}</div>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="empty" role="status">
      {label}...
    </p>
  )
}

/** Copy to clipboard with the "Copied" confirmation people expect. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      className="btn btn--ghost"
      onClick={(event) => {
        const button = event.currentTarget
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            const original = button.textContent
            button.textContent = 'Copied'
            setTimeout(() => {
              button.textContent = original
            }, 1500)
          })
          .catch(() => {
            button.textContent = 'Press Ctrl+C'
          })
      }}
    >
      {label}
    </button>
  )
}

/** "3 days ago", without pulling in a date library for eight lines of logic. */
export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`

  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
