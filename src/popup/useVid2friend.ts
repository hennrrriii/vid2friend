/**
 * The popup's data layer.
 *
 * The popup talks to Supabase directly rather than through the service worker.
 * It is a normal extension page with a normal DOM, it is only alive while it is
 * open, and routing every read through messaging would add a hop for no gain.
 * Both contexts share one session through chrome.storage.local.
 */
import { useCallback, useEffect, useState } from 'react'
import { ensureSession } from '@/shared/supabase'
import { getInbox, getMyProfile, getOutbox, listFriends, type SentShare } from '@/shared/api'
import { toUserMessage } from '@/shared/errors'
import { isConfigured } from '@/shared/env'
import type { Friend, Profile, ShelfItem } from '@/shared/types'

export interface Data {
  profile: Profile | null
  inbox: ShelfItem[]
  outbox: SentShare[]
  friends: Friend[]
}

const EMPTY: Data = { profile: null, inbox: [], outbox: [], friends: [] }

export interface Vid2friend {
  data: Data
  loading: boolean
  error: string
  configured: boolean
  reload: () => Promise<void>
  setError: (message: string) => void
  /** Runs an action, shows its error, and reloads on success. */
  run: (action: () => Promise<unknown>) => Promise<boolean>
}

export function useVid2friend(): Vid2friend {
  const [data, setData] = useState<Data>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false)
      return
    }
    try {
      await ensureSession()
      const profile = await getMyProfile()
      if (!profile) {
        setData({ ...EMPTY, profile: null })
        return
      }
      const [inbox, outbox, friends] = await Promise.all([
        getInbox(profile.id),
        getOutbox(profile.id),
        listFriends(profile.id),
      ])
      setData({ profile, inbox, outbox, friends })
      setError('')
    } catch (caught) {
      setError(toUserMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()

    // The service worker broadcasts after every change it makes, so a friend
    // accepting a request updates the open popup without a manual refresh.
    const listener = (message: { type?: string }) => {
      if (message?.type === 'state:changed') void reload()
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [reload])

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError('')
      try {
        await action()
        await reload()
        return true
      } catch (caught) {
        setError(toUserMessage(caught))
        return false
      }
    },
    [reload],
  )

  return { data, loading, error, configured: isConfigured, reload, setError, run }
}
