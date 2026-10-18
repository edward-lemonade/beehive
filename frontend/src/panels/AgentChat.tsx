import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { pollWhenDown, useLive, type ChatMsg } from '../hooks/liveContext'
import * as speech from '../lib/agentSpeech'
import { errorMessage } from '../lib/format'
import { Sentry, sentryEnabled } from '../lib/sentry'
import { CommittedDeal } from './Approvals'

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function messageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  return isToday ? timeFormatter.format(date) : dateTimeFormatter.format(date)
}

export function AgentChat() {
  const api = useApi()
  const queryClient = useQueryClient()
  const { up, chat, postChat, clearChat } = useLive()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rated, setRated] = useState<Set<number>>(() => new Set())
  const endRef = useRef<HTMLDivElement>(null)

  const arrangements = useQuery({ queryKey: ['arrangements'], queryFn: () => api.arrangements(), refetchInterval: pollWhenDown(up) })
  const channel = useQuery({ queryKey: ['channel'], queryFn: () => api.channel() })
  const texting = channel.data?.channel === 'sms'
  const entries = arrangements.data

  const announced = useRef(new Set<string>())
  const seed = () => {
    for (const e of entries ?? []) {
      if (e.terms.state === 'committed' && e.terms.approval !== 'declined') postChat({ from: 'agent', text: speech.committed(), arrangementId: e.terms.arrangementId, key: `card:${e.terms.arrangementId}` })
    }
  }
  useEffect(seed, [entries, postChat])
  const visibleChat = useMemo(() => chat.filter((message) => message.key !== 'greeting'), [chat])
  const renderedChat = useMemo(() => visibleChat.filter((message) => {
    if (!entries || !message.key?.startsWith('card:')) return true
    return entries.some((entry) => entry.terms.arrangementId === message.arrangementId && entry.terms.approval !== 'declined' && entry.terms.state === 'committed')
  }), [entries, visibleChat])

  // Coalesce nearby persisted updates into one market review, not one approval pitch per listing.
  useEffect(() => {
    const updates = (entries ?? []).flatMap(({ terms: t }) => {
      if (t.state !== 'proposed' || t.approval !== 'requested') return []
      const key = `ask:${t.arrangementId}:r${t.revision}:${t.proposal?.awaiting ?? 'approval'}`
      return announced.current.has(key) ? [] : [{ key, arrangementId: t.arrangementId }]
    })
    if (!updates.length) return
    let active = true
    const timer = setTimeout(() => {
      api.agentChat({ event: { kind: 'market_update', arrangementIds: updates.map((u) => u.arrangementId) }, history: visibleChat.slice(-16).map((m) => ({ from: m.from, text: m.text })) })
        .then((r) => {
          if (!active) return
          for (const update of updates) announced.current.add(update.key)
          postChat({ from: 'agent', text: r.reply, key: `ask:market:${updates.map((u) => u.key).sort().join('|')}` })
        })
        .catch((error: unknown) => {
          if (active) setError(errorMessage(error))
        })
    }, 600)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [entries, api, postChat, visibleChat])

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
    // A named root span, so the trace reads "agent chat" from the click through the API, the tools and the LLM.
    mutationFn: (message: string) =>
      Sentry.startSpan({ op: 'ui.action', name: 'agent chat: send message' }, () =>
        api.agentChat({ message, history: visibleChat.slice(-16).map((m) => ({ from: m.from, text: m.text })) })),
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

  // Human eval signal: a thumbs-down becomes Sentry user feedback tied to this session's replay and trace.
  // The reply text is not attached; the replay and the backend eval tags on the same trace say what went wrong.
  const flag = (id: number) => {
    setRated((prev) => new Set(prev).add(id))
    Sentry.metrics.count('agent.reply_feedback', 1, { attributes: { vote: 'down' } })
    Sentry.captureFeedback({ message: 'Bad agent reply (thumbs down in chat)', tags: { 'feedback.kind': 'agent_reply', 'gen_ai.agent.name': 'trade-agent-chat' } }, { includeReplay: true })
  }

  const busy = ask.isPending
  const failure = error

  return (
    <section aria-label="Your agent" className="dashboard-panel panel-chat flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-emerald-900/10 px-4 py-4">
        <h2 className="text-lg font-semibold">Your agent</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => { announced.current.clear(); clearChat(); seed() }} className="text-xs text-slate-500 hover:text-slate-800">Clear chat</button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-live="polite">
        {renderedChat.length === 0 && !texting && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-slate-400">
            Describe what you want to trade below; I’ll find matches and negotiate.
          </p>
        )}
        {renderedChat.map((m, index) => {
          const entry = m.arrangementId && m.key?.startsWith('card:') ? entries?.find((e) => e.terms.arrangementId === m.arrangementId && e.terms.approval !== 'declined' && e.terms.state === 'committed') : undefined
          const nextMessage = renderedChat[index + 1]
          const showTime = !nextMessage || Math.floor(m.at / 60_000) !== Math.floor(nextMessage.at / 60_000)
          return (
            <div key={m.id} className={`flex flex-col ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
              <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${m.from === 'me' ? 'rounded-br-sm bg-emerald-700 text-white' : 'rounded-bl-sm border border-white/80 bg-white/85 text-slate-900'}`}>{m.text}</p>
              {showTime && (
                <time
                  dateTime={new Date(m.at).toISOString()}
                  className={`mt-1 px-1 text-[11px] text-slate-400 ${m.from === 'me' ? 'text-right' : 'text-left'}`}
                >
                  {messageTime(m.at)}
                </time>
              )}
              {sentryEnabled && m.from === 'agent' && (!m.key || m.key.startsWith('ask:')) && (
                rated.has(m.id)
                  ? <span className="mt-0.5 text-[11px] text-slate-400">Thanks, flagged for review</span>
                  : <button onClick={() => flag(m.id)} aria-label="Flag a bad reply" title="Bad reply? Flag it" className="mt-0.5 text-[11px] text-slate-400 hover:text-red-600">👎</button>
              )}
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
          className="flex shrink-0 flex-col gap-2 border-t border-emerald-900/10 bg-white/40 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <textarea
            aria-label="Message your agent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Talk to your agent'}
            rows={5}
            className="composer-input"
          />
          <button disabled={busy || !text.trim()} className="composer-submit">Send</button>
        </form>
      )}
    </section>
  )
}
