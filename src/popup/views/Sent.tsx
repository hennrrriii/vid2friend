/**
 * "Shared": what I sent, grouped by friend, with the queue for each friend
 * reorderable by drag and drop.
 *
 * The drag is deliberately plain HTML5 drag and drop rather than a library. The
 * lists are at most twenty items long and never nested, which is exactly the
 * case the native API handles well.
 */
import { useMemo, useState } from 'react'
import { reorderQueue, unshare } from '@/shared/api'
import type { SentShare } from '@/shared/api'
import { Avatar, Empty, timeAgo } from '../components'
import type { Vid2friend } from '../useVid2friend'

interface Group {
  recipientId: string
  username: string
  color: string
  open: SentShare[]
  history: SentShare[]
}

export function Sent({ app }: { app: Vid2friend }) {
  const groups = useMemo(() => groupByRecipient(app.data.outbox), [app.data.outbox])

  if (groups.length === 0) {
    return (
      <Empty>
        You have not shared anything yet. On YouTube, use the three dot menu on a video or the
        "Share with friends" button on the watch page.
      </Empty>
    )
  }

  return (
    <div className="list">
      {groups.map((group) => (
        <FriendQueue key={group.recipientId} group={group} app={app} />
      ))}
    </div>
  )
}

function groupByRecipient(outbox: SentShare[]): Group[] {
  const map = new Map<string, Group>()

  for (const entry of outbox) {
    const existing = map.get(entry.recipient.id) ?? {
      recipientId: entry.recipient.id,
      username: entry.recipient.username,
      color: entry.recipient.avatar_color,
      open: [],
      history: [],
    }
    if (entry.share.status === 'queued' || entry.share.status === 'active') {
      existing.open.push(entry)
    } else {
      existing.history.push(entry)
    }
    map.set(entry.recipient.id, existing)
  }

  for (const group of map.values()) {
    group.open.sort(
      (a, b) =>
        a.share.sender_priority - b.share.sender_priority ||
        a.share.created_at.localeCompare(b.share.created_at),
    )
    group.history.sort((a, b) => b.share.created_at.localeCompare(a.share.created_at))
  }

  return [...map.values()].sort((a, b) => b.open.length - a.open.length)
}

function FriendQueue({ group, app }: { group: Group; app: Vid2friend }) {
  const [order, setOrder] = useState<SentShare[] | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const items = order ?? group.open

  const drop = async (targetIndex: number) => {
    if (dragging === null || dragging === targetIndex) {
      setDragging(null)
      return
    }
    const next = [...items]
    const [moved] = next.splice(dragging, 1)
    if (moved) next.splice(targetIndex, 0, moved)

    setOrder(next) // optimistic, so the row does not snap back while we save
    setDragging(null)

    await app.run(() =>
      reorderQueue(
        group.recipientId,
        next.map((entry) => entry.share.id),
      ),
    )
    // Drop the optimistic copy either way: on success the reload has the
    // authoritative order, on failure the server order is the truth.
    setOrder(null)
  }

  return (
    <section className="queue">
      <h3 className="section">
        <Avatar name={group.username} color={group.color} size={20} />
        {group.username}
        <span className="count">{group.open.length} waiting</span>
      </h3>

      {items.length === 0 && <p className="hint">Nothing waiting. They watched everything.</p>}

      {items.map((entry, index) => (
        <div
          key={entry.share.id}
          className={`row row--draggable${dragging === index ? ' row--dragging' : ''}`}
          draggable
          onDragStart={() => setDragging(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => void drop(index)}
          onDragEnd={() => setDragging(null)}
        >
          <span className="row__handle" aria-hidden="true">
            ⠿
          </span>
          <a
            className="row__thumb"
            href={`https://www.youtube.com/watch?v=${entry.share.video_id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img src={`https://i.ytimg.com/vi/${entry.share.video_id}/default.jpg`} alt="" />
          </a>
          <div className="row__body">
            <span className="row__title">{entry.share.video_title ?? 'Untitled video'}</span>
            <div className="row__meta">{describe(entry, index)}</div>
          </div>
          <button
            type="button"
            className="btn btn--tiny btn--quiet"
            title="Take it back"
            onClick={() => void app.run(() => unshare(entry.share.id))}
          >
            Undo
          </button>
        </div>
      ))}

      {group.history.length > 0 && (
        <details className="history">
          <summary>{group.history.length} already handled</summary>
          {group.history.map((entry) => (
            <div className="row row--muted" key={entry.share.id}>
              <div className="row__body">
                <span className="row__title">{entry.share.video_title ?? 'Untitled video'}</span>
                <div className="row__meta">
                  {entry.share.status === 'watched'
                    ? `Watched ${timeAgo(entry.share.watched_at)}`
                    : entry.share.status === 'dismissed'
                      ? 'Removed without watching'
                      : 'Expired'}
                </div>
              </div>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

function describe(entry: SentShare, index: number): string {
  if (entry.share.status === 'active') return 'On their homepage'
  return `Number ${index + 1} in their queue`
}
