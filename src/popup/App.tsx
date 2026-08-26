import { useState } from 'react'
import { logoMarkSvg } from '@/shared/brand'
import { ErrorBanner, Spinner } from './components'
import { useVid2friend } from './useVid2friend'
import { Onboarding } from './views/Onboarding'
import { Inbox } from './views/Inbox'
import { Sent } from './views/Sent'
import { Friends } from './views/Friends'
import { Settings } from './views/Settings'

type TabId = 'inbox' | 'sent' | 'friends' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'inbox', label: 'For you' },
  { id: 'sent', label: 'Shared' },
  { id: 'friends', label: 'Friends' },
  { id: 'settings', label: 'Settings' },
]

export function App() {
  const app = useVid2friend()
  const [tab, setTab] = useState<TabId>('inbox')

  const pending = app.data.friends.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming',
  ).length

  return (
    <div className="v2f-popup">
      <header className="v2f-header">
        <span className="v2f-logo" dangerouslySetInnerHTML={{ __html: logoMarkSvg(22) }} />
        <h1>vid2friend</h1>
        {app.data.profile && <span className="v2f-me">{app.data.profile.username}</span>}
      </header>

      {!app.configured ? (
        <div className="v2f-body">
          <div className="banner banner--info">
            <strong>Setup incomplete.</strong>
            <span>
              Add your Supabase URL and anon key to <code>.env</code>, then run{' '}
              <code>npm run build</code> and reload the extension. README section 2 walks through
              it.
            </span>
          </div>
        </div>
      ) : app.loading ? (
        <div className="v2f-body">
          <Spinner />
        </div>
      ) : !app.data.profile ? (
        <div className="v2f-body">
          <Onboarding onDone={app.reload} error={app.error} setError={app.setError} />
        </div>
      ) : (
        <>
          <nav className="v2f-tabs" role="tablist">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                className={tab === entry.id ? 'is-active' : ''}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                {entry.id === 'friends' && pending > 0 && <span className="dot">{pending}</span>}
              </button>
            ))}
          </nav>

          <main className="v2f-body">
            <ErrorBanner message={app.error} onDismiss={() => app.setError('')} />
            {tab === 'inbox' && <Inbox app={app} />}
            {tab === 'sent' && <Sent app={app} />}
            {tab === 'friends' && <Friends app={app} />}
            {tab === 'settings' && <Settings app={app} />}
          </main>
        </>
      )}
    </div>
  )
}
