import { useEffect, useRef, useState } from 'react'
import { useLive, type ChatMessage } from '../hooks/liveContext'
import { money } from '../lib/format'

function bubbleLabel(m: ChatMessage): string | null {
  const amount = m.amountCents !== null ? money(m.amountCents) : ''
  if (m.kind === 'offer') return `Offer ${amount}`.trim()
  if (m.kind === 'accept') return `Accepted ${amount}`.trim()
  if (m.kind === 'walk') return 'Walked away'
  return null
}

const clip = (s: string, n = 24): string => (s.length > n ? `${s.slice(0, n)}…` : s)

function Bubble({ message }: { message: ChatMessage }) {
  const label = bubbleLabel(message)
  return (
    <li className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${message.mine ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-slate-200 text-slate-900'}`}
      >
        {label && <p className="font-semibold">{label}</p>}
        {message.text && <p className="break-words">{message.text}</p>}
        <p className={`mt-0.5 text-[10px] ${message.mine ? 'text-emerald-100' : 'text-slate-500'}`}>
          {new Date(message.at).toLocaleTimeString()}
        </p>
      </div>
    </li>
  )
}

export function Conversations() {
  const { conversations } = useLive()
  const [picked, setPicked] = useState<string | null>(null)
  const endRef = useRef<HTMLLIElement>(null)
  const active = conversations.find((c) => c.key === picked) ?? conversations[0]
  const count = active?.messages.length ?? 0

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [active?.key, count])

  return (
    <section aria-label="Agent conversations" className="h-full">
      {conversations.length === 0 ? (
        <p className="p-3 text-sm text-slate-500">No agent conversations yet.</p>
      ) : (
        <div className="flex h-full flex-col overflow-hidden bg-white">
          <div role="tablist" aria-label="Conversations" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 p-1">
            {conversations.map((c) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={c.key === active?.key}
                onClick={() => setPicked(c.key)}
                className={`shrink-0 rounded px-2 py-1 text-xs ${c.key === active?.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                {c.handle}
                {c.mineText && <span className="ml-1 opacity-70">· {clip(c.mineText)}</span>}
              </button>
            ))}
          </div>
          {active && (
            <>
              <p className="shrink-0 px-3 pt-2 text-xs text-slate-500">
                Your agent (right){active.mineText && <> for “{clip(active.mineText, 60)}”</>} and {active.handle}'s agent (left)
                {active.theirText && <> for “{clip(active.theirText, 60)}”</>}
              </p>
              <ul role="tabpanel" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {active.messages.map((m) => <Bubble key={m.id} message={m} />)}
                <li ref={endRef} aria-hidden />
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
