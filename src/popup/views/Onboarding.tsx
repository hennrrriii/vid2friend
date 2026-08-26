/**
 * First run. Two things can happen here: pick a name (new account), or paste a
 * backup code (this is a second machine, or a fresh Chrome profile).
 *
 * There is no password and no email anywhere in this flow. The anonymous
 * Supabase session was created silently before this screen rendered; all the
 * user does is choose how their friends will see them.
 */
import { useState } from 'react'
import { createProfile, restoreAccount } from '@/shared/api'
import { logoMarkSvg } from '@/shared/brand'
import { ErrorBanner } from '../components'

export function Onboarding({
  onDone,
  error,
  setError,
}: {
  onDone: () => Promise<void>
  error: string
  setError: (message: string) => void
}) {
  const [mode, setMode] = useState<'create' | 'restore'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (mode === 'create') await createProfile(name.trim())
      else await restoreAccount(code.trim())
      await onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const valid =
    mode === 'create' ? name.trim().length >= 2 && name.trim().length <= 24 : code.trim().length > 10

  return (
    <div className="onboarding">
      <span className="onboarding__logo" dangerouslySetInnerHTML={{ __html: logoMarkSvg(44) }} />
      <h2>vid2friend</h2>
      <p className="onboarding__lead">
        Send YouTube videos to friends. They show up at the top of their YouTube homepage.
      </p>

      <ErrorBanner message={error} />

      {mode === 'create' ? (
        <>
          <label className="field">
            <span>How should your friends see you?</span>
            <input
              value={name}
              autoFocus
              maxLength={24}
              placeholder="Your name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && valid) void submit()
              }}
            />
          </label>
          <button className="btn btn--primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Setting up...' : 'Get started'}
          </button>
          <button className="btn btn--link" onClick={() => setMode('restore')}>
            I already have an account on another computer
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Backup code</span>
            <input
              value={code}
              autoFocus
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <p className="hint">
            Find it in vid2friend on your other computer under Settings, "Backup code".
          </p>
          <button className="btn btn--primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Restoring...' : 'Restore account'}
          </button>
          <button className="btn btn--link" onClick={() => setMode('create')}>
            Create a new account instead
          </button>
        </>
      )}
    </div>
  )
}
