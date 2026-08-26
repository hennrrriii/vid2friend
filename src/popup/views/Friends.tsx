/**
 * "Friends": requests waiting for an answer, the friend list, and the two ways
 * to add someone (code or personal link).
 *
 * Friendship is confirmed on both sides before anything can be shared. That is
 * the entire spam protection, which is why the incoming requests sit at the top
 * where they cannot be missed.
 */
import { useState } from 'react'
import { removeFriend, respondToFriendRequest, sendFriendRequest } from '@/shared/api'
import { Avatar, CopyButton, Empty, timeAgo } from '../components'
import type { Vid2friend } from '../useVid2friend'

export function Friends({ app }: { app: Vid2friend }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const profile = app.data.profile
  if (!profile) return null

  const incoming = app.data.friends.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming',
  )
  const outgoing = app.data.friends.filter(
    (f) => f.status === 'pending' && f.direction === 'outgoing',
  )
  const accepted = app.data.friends.filter((f) => f.status === 'accepted')

  // The code is in the query AND the fragment on purpose. A fragment never
  // reaches a server, so it survives anything YouTube might do with unknown
  // query parameters, including a redirect that drops them.
  const inviteLink = `https://www.youtube.com/?v2f=${profile.friend_code}#v2f=${profile.friend_code}`
  const inviteText =
    `Add me on vid2friend so I can send you videos: ${inviteLink}\n` +
    `Install it first from the Chrome Web Store, otherwise the link just opens YouTube.`

  const add = async () => {
    setBusy(true)
    const ok = await app.run(() => sendFriendRequest(code))
    if (ok) setCode('')
    setBusy(false)
  }

  return (
    <div className="list">
      {incoming.length > 0 && (
        <>
          <h3 className="section">Wants to connect</h3>
          {incoming.map((friend) => (
            <div className="row" key={friend.friendshipId}>
              <Avatar name={friend.profile.username} color={friend.profile.avatar_color} />
              <div className="row__body">
                <span className="row__title">{friend.profile.username}</span>
                <div className="row__meta">{timeAgo(friend.since)}</div>
              </div>
              <div className="row__actions">
                <button
                  className="btn btn--tiny btn--primary"
                  onClick={() => void app.run(() => respondToFriendRequest(friend.friendshipId, true))}
                >
                  Accept
                </button>
                <button
                  className="btn btn--tiny btn--quiet"
                  onClick={() => void app.run(() => respondToFriendRequest(friend.friendshipId, false))}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h3 className="section">Add a friend</h3>
      <div className="inline">
        <input
          value={code}
          placeholder="Friend code, e.g. K7M2PQR4"
          maxLength={8}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.length === 8) void add()
          }}
        />
        <button className="btn btn--primary" disabled={code.length !== 8 || busy} onClick={() => void add()}>
          Add
        </button>
      </div>

      <div className="codebox">
        <div className="codebox__label">Your friend code</div>
        <div className="codebox__value">{profile.friend_code}</div>
        <div className="codebox__actions">
          <CopyButton value={profile.friend_code} label="Copy code" />
          <CopyButton value={inviteText} label="Copy invite link" />
        </div>
        <p className="hint">
          The link opens YouTube and asks them to connect. Without the extension installed it is
          just a normal YouTube link, so send the install hint along with it.
        </p>
      </div>

      <h3 className="section">
        Friends<span className="count">{accepted.length}</span>
      </h3>
      {accepted.length === 0 && <Empty>No friends yet. Send someone your code.</Empty>}
      {accepted.map((friend) => (
        <div className="row" key={friend.friendshipId}>
          <Avatar name={friend.profile.username} color={friend.profile.avatar_color} />
          <div className="row__body">
            <span className="row__title">{friend.profile.username}</span>
            <div className="row__meta">Friends since {timeAgo(friend.since)}</div>
          </div>
          <button
            className="btn btn--tiny btn--quiet"
            title="Removing also deletes everything still waiting between you"
            onClick={() => {
              if (confirm(`Remove ${friend.profile.username}? Anything still waiting between you is deleted.`)) {
                void app.run(() => removeFriend(friend.profile.id))
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}

      {outgoing.length > 0 && (
        <>
          <h3 className="section">Waiting for them</h3>
          {outgoing.map((friend) => (
            <div className="row row--muted" key={friend.friendshipId}>
              <Avatar name={friend.profile.username} color={friend.profile.avatar_color} />
              <div className="row__body">
                <span className="row__title">{friend.profile.username}</span>
                <div className="row__meta">Request sent {timeAgo(friend.since)}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
