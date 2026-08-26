/**
 * "Settings": display name, shelf size, expiry, pause, backup code, delete.
 *
 * The backup code section is the important one and is documented at length in
 * the README. The anonymous identity is bound to this Chrome profile; without
 * that code, a new laptop means a new account.
 */
import { useEffect, useState } from 'react'
import {
  deleteAccount,
  getRecoveryCode,
  rotateRecoveryCode,
  updateProfile,
} from '@/shared/api'
import { CopyButton } from '../components'
import type { Vid2friend } from '../useVid2friend'

export function Settings({ app }: { app: Vid2friend }) {
  const profile = app.data.profile
  const [name, setName] = useState(profile?.username ?? '')
  const [code, setCode] = useState<string | null>(null)
  const [codeVisible, setCodeVisible] = useState(false)

  useEffect(() => {
    setName(profile?.username ?? '')
  }, [profile?.username])

  useEffect(() => {
    if (!codeVisible || code) return
    void getRecoveryCode()
      .then(setCode)
      .catch(() => setCode(null))
  }, [codeVisible, code])

  if (!profile) return null

  return (
    <div className="list settings">
      <label className="field">
        <span>Display name</span>
        <div className="inline">
          <input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} />
          <button
            className="btn btn--primary"
            disabled={name.trim() === profile.username || name.trim().length < 2}
            onClick={() => void app.run(() => updateProfile({ username: name.trim() }))}
          >
            Save
          </button>
        </div>
      </label>

      <label className="field">
        <span>Videos on your homepage: {profile.slot_count}</span>
        <input
          type="range"
          min={3}
          max={8}
          value={profile.slot_count}
          onChange={(event) =>
            void app.run(() => updateProfile({ slot_count: Number(event.target.value) }))
          }
        />
        <p className="hint">
          How many recommendations sit above your YouTube feed. The rest wait in the queue.
        </p>
      </label>

      <label className="field">
        <span>Forget unwatched videos after</span>
        <select
          value={profile.expire_after_days}
          onChange={(event) =>
            void app.run(() => updateProfile({ expire_after_days: Number(event.target.value) }))
          }
        >
          <option value={0}>Never</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <p className="hint">Keeps the queue from filling up with things you will never watch.</p>
      </label>

      <label className="switch">
        <input
          type="checkbox"
          checked={profile.paused}
          onChange={(event) => void app.run(() => updateProfile({ paused: event.target.checked }))}
        />
        <span>
          Pause vid2friend
          <small>Hides the shelf on YouTube. Nothing is lost, everything waits in the queue.</small>
        </span>
      </label>

      <div className="field">
        <span>Backup code</span>
        <p className="hint">
          Your account lives in this Chrome profile. This code is the only way to get it back on
          another computer, or after clearing your browser data. Store it somewhere safe.
        </p>
        {codeVisible ? (
          <>
            <div className="codebox__value codebox__value--small">{code ?? 'Loading...'}</div>
            <div className="inline">
              {code && <CopyButton value={code} label="Copy" />}
              <button
                className="btn btn--ghost"
                onClick={() => {
                  if (
                    confirm(
                      'Generate a new backup code? The old one stops working immediately.',
                    )
                  ) {
                    void rotateRecoveryCode().then(setCode)
                  }
                }}
              >
                Generate a new one
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn--ghost" onClick={() => setCodeVisible(true)}>
            Show backup code
          </button>
        )}
      </div>

      <div className="field danger">
        <span>Delete account</span>
        <p className="hint">
          Removes your profile, your friendships and every video you sent or received. This cannot
          be undone.
        </p>
        <button
          className="btn btn--danger"
          onClick={() => {
            if (confirm('Delete your vid2friend account for good?')) {
              void app.run(async () => {
                await deleteAccount()
                await chrome.storage.local.clear()
                window.close()
              })
            }
          }}
        >
          Delete my account
        </button>
      </div>

      <p className="version">vid2friend v{__APP_VERSION__}</p>
    </div>
  )
}
