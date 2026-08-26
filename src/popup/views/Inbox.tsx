/**
 * "For you": the recommendations currently on the shelf, and what is waiting
 * behind them.
 */
import { dismissShare, markWatched } from '@/shared/api'
import { Avatar, Empty, timeAgo } from '../components'
import type { ShelfItem } from '@/shared/types'
import type { Vid2friend } from '../useVid2friend'

export function Inbox({ app }: { app: Vid2friend }) {
  const active = app.data.inbox.filter((item) => item.share.status === 'active')
  const queued = app.data.inbox.filter((item) => item.share.status === 'queued')
  const slots = app.data.profile?.slot_count ?? 6

  if (app.data.inbox.length === 0) {
    return (
      <Empty>
        Nothing waiting for you. When a friend shares a video it appears here and at the top of
        your YouTube homepage.
      </Empty>
    )
  }

  return (
    <div className="list">
      <h3 className="section">
        On your homepage
        <span className="count">
          {active.length}/{slots}
        </span>
      </h3>
      {active.map((item) => (
        <Row key={item.share.id} item={item} app={app} />
      ))}

      {queued.length > 0 && (
        <>
          <h3 className="section">
            Up next
            <span className="count">{queued.length}</span>
          </h3>
          {queued.map((item) => (
            <Row key={item.share.id} item={item} app={app} muted />
          ))}
        </>
      )}
    </div>
  )
}

function Row({ item, app, muted }: { item: ShelfItem; app: Vid2friend; muted?: boolean }) {
  const { share, sender } = item

  return (
    <div className={`row${muted ? ' row--muted' : ''}`}>
      <a
        className="row__thumb"
        href={`https://www.youtube.com/watch?v=${share.video_id}`}
        target="_blank"
        rel="noreferrer"
      >
        <img src={`https://i.ytimg.com/vi/${share.video_id}/default.jpg`} alt="" />
      </a>

      <div className="row__body">
        <a
          className="row__title"
          href={`https://www.youtube.com/watch?v=${share.video_id}`}
          target="_blank"
          rel="noreferrer"
        >
          {share.video_title ?? 'Untitled video'}
        </a>
        <div className="row__meta">
          <Avatar name={sender.username} color={sender.avatar_color} size={18} />
          <span>
            {sender.username} · {timeAgo(share.created_at)}
          </span>
        </div>
        {share.note && <div className="row__note">"{share.note}"</div>}
      </div>

      <div className="row__actions">
        <button
          type="button"
          className="btn btn--tiny"
          title="Mark as watched"
          onClick={() => void app.run(() => markWatched(share.id))}
        >
          Watched
        </button>
        <button
          type="button"
          className="btn btn--tiny btn--quiet"
          title="Remove without watching"
          onClick={() => void app.run(() => dismissShare(share.id))}
        >
          Remove
        </button>
      </div>
    </div>
  )
}
