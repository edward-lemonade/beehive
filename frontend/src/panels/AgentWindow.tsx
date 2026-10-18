import { useState } from 'react'
import { useLive } from '../hooks/liveContext'
import { Conversations } from './Conversations'

/** Agent-to-agent conversations: collapsed to a corner icon, mostly useful for debugging. */
export function AgentWindow() {
  const { conversations } = useLive()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const total = conversations.reduce((n, c) => n + c.messages.length, 0)
  const unread = open ? 0 : Math.max(0, total - seen)

  const toggle = () => {
    setSeen(total)
    setOpen((v) => !v)
  }

  return (
    <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="Agent to agent conversations" className="h-[28rem] max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl">
          <Conversations />
        </div>
      )}
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Hide agent conversations' : 'Show agent conversations'}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-xl text-white shadow-lg"
      >
        <span aria-hidden>{open ? '×' : '💬'}</span>
        {unread > 0 && (
          <span data-testid="agent-badge" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-xs">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
    </div>
  )
}
