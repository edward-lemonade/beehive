import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { pollWhenDown, useLive, type ChatMsg } from '../hooks/liveContext'
import * as speech from '../lib/agentSpeech'
import { errorMessage, money } from '../lib/format'
import { ApprovalCard, type CardOutcome } from './Approvals'
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

  // Pending and committed arrangements are rebuilt from the API, so a reload brings them back.
  const seed = () => {
    postChat({ from: 'agent', text: speech.greeting(), key: 'greeting' })
    for (const e of entries ?? []) {
      const t = e.terms
      if (t.approval === 'declined') continue
      const live = t.state === 'committed' || t.approval === 'requested' || t.approval === 'approved'
      if (!live) continue
      postChat({ from: 'agent', text: t.state === 'committed' ? speech.committed() : speech.matchFound(), arrangementId: t.arrangementId, key: `card:${t.arrangementId}` })
    }
  }
  useEffect(seed, [entries, postChat])

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
  const counter = useMutation({
    mutationFn: ({ arrangementId, cents }: { arrangementId: string; cents: number }) => api.arrangementAction(arrangementId, 'negotiate-further', { targetCents: cents }),
  })

  const role = (arrangementId: string): speech.Role =>
    entries?.find((e) => e.terms.arrangementId === arrangementId)?.terms.cashOut.length ? 'payer' : 'receiver'
  const handleFor = (arrangementId: string): string => {
    const t = entries?.find((e) => e.terms.arrangementId === arrangementId)?.terms
    return t?.cashOut[0]?.toHandle ?? t?.cashIn[0]?.fromHandle ?? 'Their agent'
  }

  const report = (arrangementId: string, targetCents: number | undefined, result: CardOutcome['result']) => {
    const handle = handleFor(arrangementId)
    if (result.status === 'pending') {
      say(speech.askedThem(handle, result.amountCents ?? targetCents))
    } else if (result.status === 'failed') {
      say(result.reason === 'no_overlap' || result.reason === 'no_agreement' ? speech.priceFinal(handle, targetCents) : speech.couldNotChange())
    } else if (result.status === 'agreed' && result.amountCents !== undefined) {
      const r = role(arrangementId)
      say(speech.priceCameDown(handle, result.amountCents, r), { suggest: { arrangementId, cents: speech.nextSuggestion(result.amountCents, r) } })
    } else {
      say(speech.negotiating(handle))
    }
  }

  const onOutcome = (arrangementId: string) => ({ action, targetCents, result }: CardOutcome) => {
    if (action === 'approve') postChat({ from: 'me', text: 'Approve it.' })
    else if (action === 'decline' || action === 'decline-withdraw') { postChat({ from: 'me', text: 'Decline.' }); say(speech.declined()) }
    else if (action === 'retract') { postChat({ from: 'me', text: 'Retract my approval.' }); say(speech.retracted()) }
    else {
      postChat({ from: 'me', text: targetCents !== undefined ? `Could you do ${money(targetCents)}?` : 'Keep negotiating.' })
      report(arrangementId, targetCents, result)
    }
  }

  const trySuggestion = (arrangementId: string, cents: number) => {
    postChat({ from: 'me', text: `Try ${money(cents)}.` })
    counter.mutate({ arrangementId, cents }, { onSuccess: (r) => report(arrangementId, cents, r), onError: (e) => setError(errorMessage(e)) })
  }

  const submit = () => {
    const value = text.trim()
    if (!value || texting) return
    setText('')
    setError(null)
    postChat({ from: 'me', text: value })
    ask.mutate(value, { onError: (e) => setError(errorMessage(e)) })
  }

  const busy = ask.isPending || counter.isPending
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
          const entry = m.arrangementId && m.key?.startsWith('card:') ? entries?.find((e) => e.terms.arrangementId === m.arrangementId && e.terms.approval !== 'declined') : undefined
          return (
            <div key={m.id} className={`flex flex-col ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
              <p className={`max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-sm ${m.from === 'me' ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-900'}`}>{m.text}</p>
              {entry && (
                <ul className="mt-2 w-full max-w-[95%]">
                  <ApprovalCard entry={entry} onOutcome={onOutcome(entry.terms.arrangementId)} />
                </ul>
              )}
              {m.suggest && (
                <button disabled={busy} onClick={() => trySuggestion(m.suggest!.arrangementId, m.suggest!.cents)} className="mt-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                  Try {money(m.suggest.cents)}
                </button>
              )}
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
