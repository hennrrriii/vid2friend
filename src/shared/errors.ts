/**
 * Turns database errors into sentences a human can act on.
 *
 * The database raises stable identifiers (V2F_QUEUE_FULL and friends) instead
 * of prose, so the wording lives here and can change without a migration.
 * Anything unrecognised falls back to a generic message - we never show a raw
 * Postgres error to the user, but we do log it.
 */
import { log } from './log'

const MESSAGES: Record<string, string> = {
  V2F_NOT_AUTHENTICATED: 'Not signed in yet. Open the vid2friend popup once and try again.',
  V2F_NO_PROFILE: 'Your profile is not set up yet. Open the vid2friend popup and pick a name.',
  V2F_INVALID_USERNAME: 'Pick a name between 2 and 24 characters.',
  V2F_CODE_NOT_FOUND: 'No one found with that friend code. Check for typos.',
  V2F_CANNOT_ADD_SELF: 'That is your own friend code.',
  V2F_ALREADY_FRIENDS: 'You are already friends.',
  V2F_REQUEST_PENDING: 'You already sent a request. Waiting for them to accept.',
  V2F_REQUEST_NOT_FOUND: 'That friend request no longer exists.',
  V2F_ALREADY_ANSWERED: 'That request was already answered.',
  V2F_NOT_ALLOWED: 'You are not allowed to do that.',
  V2F_NOT_FRIENDS: 'You can only share with confirmed friends.',
  V2F_QUEUE_FULL: 'They already have 20 unwatched videos from you. Give them a chance to catch up.',
  V2F_INVALID_RECOVERY_CODE: 'That backup code is not valid.',
  V2F_PROFILE_ALREADY_ON_THIS_DEVICE:
    'This browser profile already has a vid2friend account. Delete it under Settings first, then restore.',
  V2F_CODE_GENERATION_FAILED: 'Could not generate a friend code. Please try again.',
}

/** Duplicate key on shares_unique_open - the only 23505 a user can trigger. */
const DUPLICATE_SHARE = 'You already sent them that video.'

export function toUserMessage(error: unknown): string {
  const raw = extractText(error)

  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message
  }

  if (raw.includes('shares_unique_open') || raw.includes('duplicate key')) {
    return DUPLICATE_SHARE
  }
  if (raw.includes('row-level security') || raw.includes('violates row-level')) {
    return 'The server refused that. You may not be friends (any more).'
  }
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('timeout')) {
    return 'No connection. Check your internet and try again.'
  }

  log.error('unmapped error', error)
  return 'Something went wrong. Please try again.'
}

function extractText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return `${error.message} ${error.stack ?? ''}`
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>
    return [e.message, e.details, e.hint, e.code].filter(Boolean).join(' ')
  }
  return String(error)
}

/**
 * Wraps a promise in a timeout. Supabase calls can hang for a very long time on
 * a flaky connection, and a spinner that never stops is worse than an error.
 */
// PromiseLike, not Promise: Supabase's query builders are thenables that only
// fire the request once you await them. Requiring a real Promise here would
// force a `.then()` at every call site and start the request twice as often.
export async function withTimeout<T>(promise: PromiseLike<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
