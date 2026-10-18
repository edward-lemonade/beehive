import { useState } from 'react'
import { PublicIntents } from './feed/PublicIntents'
import { LiveProvider } from './hooks/live'
import { AgentChat } from './panels/AgentChat'
import { AgentWindow } from './panels/AgentWindow'
import { MyIntents } from './panels/MyIntents'

const tabs = ['Mine', 'Agent', 'Feed'] as const
type Tab = (typeof tabs)[number]

function Layout() {
  const [tab, setTab] = useState<Tab>('Agent')
  const show = (name: Tab) => (tab === name ? 'block' : 'hidden lg:block')

  return (
    <>
      <nav className="mb-3 flex gap-1 lg:hidden" aria-label="Sections">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            aria-pressed={tab === name}
            className={`flex-1 rounded px-2 py-1 text-sm ${tab === name ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300'}`}
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="grid gap-4 lg:h-[calc(100vh-6rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={`${show('Mine')} lg:min-h-0`}>
          <MyIntents />
        </div>
        <div className={`${show('Agent')} h-[calc(100vh-9rem)] lg:h-auto lg:min-h-0`}>
          <AgentChat />
        </div>
        <div className={`${show('Feed')} lg:min-h-0`}>
          <PublicIntents />
        </div>
      </div>
      <AgentWindow />
    </>
  )
}

export function Dashboard() {
  return (
    <LiveProvider>
      <Layout />
    </LiveProvider>
  )
}
