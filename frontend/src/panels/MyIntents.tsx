import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/context'
import type { Draft, MyIntent } from '../api/schemas'
import { pollWhenDown, useLive } from '../hooks/liveContext'
import { errorMessage, money } from '../lib/format'

function NearMisses({ intentId }: { intentId: string }) {
  const api = useApi()
  const query = useQuery({ queryKey: ['near-misses', intentId], queryFn: () => api.nearMisses(intentId) })
  if (!query.data?.length) return null
  return (
    <ul className="mt-2 space-y-1 text-xs text-slate-600">
      {query.data.map((miss, i) => (
        <li key={i}>
          Near miss with {miss.otherHandle}: {miss.kind === 'price' ? `${money(miss.gapCents)} apart` : 'dates do not overlap'}. {miss.text}
        </li>
      ))}
    </ul>
  )
}

function IntentRow({ intent, onDraft }: { intent: MyIntent; onDraft: (draft: Draft) => void }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState(intent.public.freeText)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
    void queryClient.invalidateQueries({ queryKey: ['public'] })
    void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
  }

  const save = useMutation({ mutationFn: () => api.editIntent(intent.id, text), onSuccess: () => { setEditing(false); refresh() } })
  const withdraw = useMutation({ mutationFn: () => api.withdraw(intent.id), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.deleteIntent(intent.id), onSuccess: refresh })
  const reopen = useMutation({ mutationFn: () => api.reopen(intent.id), onSuccess: onDraft })
  const keep = useMutation({ mutationFn: () => api.keepLooking(intent.id) })
  const error = save.error ?? withdraw.error ?? remove.error ?? reopen.error ?? keep.error
  const isOpen = intent.state === 'open'

  return (
    <li className="relative rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm">
      <button
        aria-label="Delete intent"
        title="Delete intent"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      <div className="flex items-center gap-2 pr-6">
        <span className="rounded bg-slate-100 px-1.5 text-xs uppercase">{intent.state}</span>
        <span className="text-xs text-slate-500">v{intent.version}</span>
      </div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-2 w-full rounded border border-slate-300 p-2" />
      ) : (
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? 'Collapse intent' : 'Show full intent'}
          className={`mt-1 w-full wrap-break-word text-left text-sm leading-5 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}
        >
          {intent.public.freeText}
        </button>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
        {isOpen && !editing && <button onClick={() => setEditing(true)} className="rounded border border-slate-300 px-2 py-0.5">Edit</button>}
        {editing && (
          <>
            <button disabled={save.isPending || !text.trim()} onClick={() => save.mutate()} className="rounded bg-slate-900 px-2 py-0.5 text-white disabled:opacity-50">Save</button>
            <button onClick={() => { setEditing(false); setText(intent.public.freeText) }} className="rounded border border-slate-300 px-2 py-0.5">Cancel</button>
          </>
        )}
        {isOpen && <button disabled={withdraw.isPending} onClick={() => withdraw.mutate()} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">Withdraw</button>}
        {isOpen && <button disabled={keep.isPending} onClick={() => keep.mutate()} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">Push agent</button>}
        {(intent.state === 'withdrawn' || intent.state === 'expired') && (
          <button disabled={reopen.isPending} onClick={() => reopen.mutate()} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">Reopen</button>
        )}
      </div>
      {keep.isSuccess && <p className="mt-1 text-xs text-slate-500">Your agent is looking again.</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{errorMessage(error)}</p>}
      {isOpen && <NearMisses intentId={intent.id} />}
    </li>
  )
}

function NewIntent({ draft, setDraft }: { draft: Draft | null; setDraft: (draft: Draft | null) => void }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { chat, postChat } = useLive()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A complete draft is posted straight away, then the agent looks for matches and reports.
  const advance = async (next: Draft) => {
    if (next.question) return setDraft(next)
    setDraft(null)
    await api.confirmDraft(next.id)
    void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
    void queryClient.invalidateQueries({ queryKey: ['public'] })
    try {
      const r = await api.agentChat({ event: { kind: 'intent_posted' }, history: chat.slice(-16).map((m) => ({ from: m.from, text: m.text })) })
      postChat({ from: 'agent', text: r.reply })
      if (r.changed) void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
    } catch {
      // The listing is posted; the agent just has nothing to say yet.
    }
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await advance(draft?.question ? await api.answerDraft(draft.id, value) : await api.createDraft(value))
      setText('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="shrink-0 border-t border-amber-900/10 bg-white/40 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {draft?.question && <p className="mb-1 text-sm text-slate-700">{draft.question}</p>}
      <div className="flex flex-col gap-2">
        <textarea
          aria-label="New intent"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={draft?.question ? 'Your answer' : 'e.g. selling a ticket for $100'}
          rows={5}
          className="composer-input"
        />
        <button disabled={busy || !text.trim()} className="composer-submit">
          {busy ? 'Working…' : draft?.question ? 'Answer' : 'Create'}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </form>
  )
}

export function MyIntents() {
  const api = useApi()
  const [draft, setDraft] = useState<Draft | null>(null)
  const { up } = useLive()
  const queryClient = useQueryClient()
  const seed = useMutation({
    mutationFn: () => api.loadSeed(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
      void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
    },
  })
  const query = useQuery({ queryKey: ['mine-intents'], queryFn: () => api.myIntents(), refetchInterval: pollWhenDown(up) })
  return (
    <section aria-label="Your intents" className="dashboard-panel panel-mine flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-900/10 px-4 py-4">
        <h2 className="text-lg font-semibold">Your intents</h2>
        <button disabled={seed.isPending} onClick={() => seed.mutate()} className="rounded-lg border border-amber-900/15 bg-white/70 px-2 py-1 text-xs disabled:opacity-50">
          {seed.isPending ? 'Loading…' : 'Load seed data'}
        </button>
      </div>
      {seed.isError && <p role="alert" className="px-4 pt-2 text-xs text-red-600">{errorMessage(seed.error)}</p>}
      <div role="region" aria-label="Your intent list" tabIndex={0} className="intent-scroll mx-3 my-3 min-h-0 flex-1 overflow-y-scroll rounded-xl border border-amber-900/15 bg-white/25 p-2">
      {query.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(query.error)}</p>}
      {query.data?.length === 0 && <p className="text-sm text-slate-500">Nothing posted yet.</p>}
      <ul className="space-y-1.5">{query.data?.map((intent) => <IntentRow key={intent.id} intent={intent} onDraft={setDraft} />)}</ul>
      </div>
      <NewIntent draft={draft} setDraft={setDraft} />
    </section>
  )
}
