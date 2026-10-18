import { useState } from 'react'
import { PublicIntents } from './feed/PublicIntents'
import { LiveProvider } from './hooks/live'
import { AgentChat } from './panels/AgentChat'
import { MyIntents } from './panels/MyIntents'

const tabs = ['Mine', 'Agent', 'Feed'] as const
type Tab = (typeof tabs)[number]

function Layout() {
  const [tab, setTab] = useState<Tab>('Agent')
  const show = (name: Tab) => (tab === name ? 'block' : 'hidden lg:block')

  return (
    <>
      <nav className="mb-3 flex shrink-0 gap-1 rounded-xl bg-white/80 p-1 lg:hidden" aria-label="Sections">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            aria-pressed={tab === name}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium ${tab === name ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-5">
        <div className={`${show('Mine')} h-[calc(100dvh-12rem)] min-h-[480px] lg:h-auto lg:min-h-0`}>
          <MyIntents />
        </div>
        <div className={`${show('Agent')} h-[calc(100dvh-12rem)] min-h-[480px] lg:h-auto lg:min-h-0`}>
          <AgentChat />
        </div>
        <div className={`${show('Feed')} lg:min-h-0`}>
          <PublicIntents />
        </div>
      </div>
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
