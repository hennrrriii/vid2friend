import { useState } from 'react'
import { isConfigured } from '@/shared/env'
import { logoMarkSvg } from '@/shared/brand'

type TabId = 'inbox' | 'sent' | 'friends' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'inbox', label: 'For you' },
  { id: 'sent', label: 'Shared' },
  { id: 'friends', label: 'Friends' },
  { id: 'settings', label: 'Settings' },
]

export function App() {
  const [tab, setTab] = useState<TabId>('inbox')

  return (
    <div className="v2f-popup">
      <header className="v2f-header">
        <span className="v2f-logo" dangerouslySetInnerHTML={{ __html: logoMarkSvg(22) }} />
        <h1>vid2friend</h1>
      </header>

      {!isConfigured && (
        <div className="v2f-notice">
          <strong>Setup incomplete.</strong>
          <span>
            Add your Supabase URL and anon key to <code>.env</code>, then rebuild. See README
            section 2.
          </span>
        </div>
      )}

      <nav className="v2f-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'is-active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="v2f-body">
        <p className="v2f-placeholder">
          Nothing here yet. This screen gets filled in as the milestones land.
        </p>
      </main>

      <footer className="v2f-footer">v{__APP_VERSION__}</footer>
    </div>
  )
}
