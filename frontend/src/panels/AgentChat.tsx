import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { pollWhenDown, useLive, type ChatMsg } from '../hooks/liveContext'
import * as speech from '../lib/agentSpeech'
import { errorMessage } from '../lib/format'
import { CommittedDeal } from './Approvals'
import { ChannelToggle } from './ChannelToggle'

export function AgentChat() {
  const api = useApi()
  const queryClient = useQueryClient()
  const { up, chat, postChat, clearChat } = useLive()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
    const endRef = useRef<HTMLDivElement>(null)

  const arrangements = useQuery({ queryKey: ['arrangements'], queryFn: () => api.arrangements(), refetchInterval: pollWhenDown(up) })
  const channel = useQuery({ queryKey: ['channel'], queryFn: () => api.channel() })
  const texting = channel.data?.channel === 'sms'
  const entries = arrangements.data

  const announced = useRef(new Set<string>())
  const seed = () => {
    announced.current.clear()
    postChat({ from: 'agent', text: speech.greeting(), key: 'greeting' })
    for (const e of entries ?? []) {
      if (e.terms.state === 'committed' && e.terms.approval !== 'declined') postChat({ from: 'agent', text: speech.committed(), arrangementId: e.terms.arrangementId, key: `card:${e.terms.arrangementId}` })
    }
  }
  useEffect(seed, [entries, postChat])

  // An arrangement waiting on the user is put to them in words, once per price, by the agent.
  useEffect(() => {
    for (const e of entries ?? []) {
      const t = e.terms
      if (t.state !== 'proposed' || t.approval !== 'requested') continue
      const price = t.cashOut[0]?.amountCents ?? t.cashIn[0]?.amountCents ?? 0
      const key = `ask:${t.arrangementId}:${price}`
      if (announced.current.has(key)) continue
      announced.current.add(key)
      api.agentChat({ event: { kind: 'approval_request', arrangementId: t.arrangementId, amountCents: price }, history: chat.slice(-16).map((m) => ({ from: m.from, text: m.text })) })
        .then((r) => postChat({ from: 'agent', text: r.reply, key }))
        .catch(() => postChat({ from: 'agent', text: speech.matchFound(), key }))
    }
  }, [entries]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [chat.length])

  const say = (message: string, extra: Partial<ChatMsg> = {}) => postChat({ from: 'agent', text: message, ...extra })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
    void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
    void queryClient.invalidateQueries({ queryKey: ['public'] })
  }

  const ask = useMutation({
    mutationFn: (message: string) =>
      api.agentChat({ message, history: chat.slice(-16).map((m) => ({ from: m.from, text: m.text })) }),
    onSuccess: (r) => {
      say(r.reply)
      if (r.changed) refresh()
    },
  })
  const submit = () => {
    const value = text.trim()
    if (!value || texting) return
    setText('')
    setError(null)
    postChat({ from: 'me', text: value })
    ask.mutate(value, { onError: (e) => setError(errorMessage(e)) })
  }

  const busy = ask.isPending
  const failure = error

  return (
    <section aria-label="Your agent" className="flex h-full min-h-0 flex-col rounded border border-slate-200 bg-white">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-lg font-semibold">Your agent</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => { clearChat(); seed() }} className="text-xs text-slate-500 hover:text-slate-800">Clear chat</button>
          <ChannelToggle />
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" role="log" aria-live="polite">
        {chat.map((m) => {
          const entry = m.arrangementId && m.key?.startsWith('card:') ? entries?.find((e) => e.terms.arrangementId === m.arrangementId && e.terms.approval !== 'declined' && e.terms.state === 'committed') : undefined
          if (entries && m.key?.startsWith('card:') && !entry) return null
          return (
            <div key={m.id} className={`flex flex-col ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
              <p className={`max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-sm ${m.from === 'me' ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-900'}`}>{m.text}</p>
              {entry && <CommittedDeal entry={entry} />}
            </div>
          )
        })}
        {busy && <p className="text-xs text-slate-500">Your agent is typing…</p>}
        <div ref={endRef} aria-hidden />
      </div>
      {failure && <p role="alert" className="px-3 text-sm text-red-600">{failure}</p>}
      {texting ? (
        <p className="shrink-0 border-t border-slate-200 p-3 text-sm text-slate-600">Your agent is texting you. Switch back to Chat to continue here.</p>
      ) : (
        <form
          className="flex shrink-0 gap-2 border-t border-slate-200 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            aria-label="Message your agent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Talk to your agent'}
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button disabled={busy || !text.trim()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Send</button>
        </form>
      )}
    </section>
  )
}
