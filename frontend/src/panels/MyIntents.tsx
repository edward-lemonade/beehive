import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import type { Draft, MyIntent } from '../api/schemas'
import { pollWhenDown, useLive } from '../hooks/liveContext'
import { errorMessage, money } from '../lib/format'
import { useSeedDataDialog } from '../useSeedDataDialog'

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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteDialog = useRef<HTMLDialogElement>(null)
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
  useEffect(() => {
    const dialog = deleteDialog.current
    if (!dialog) return
    if (confirmingDelete) dialog.showModal()
    else dialog.close()
  }, [confirmingDelete])

  return (
    <li className="relative rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm">
        <button
          aria-label="Delete listing"
          title="Delete listing"
          disabled={remove.isPending}
          onClick={() => setConfirmingDelete(true)}
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
            title={expanded ? 'Collapse listing' : 'Show full listing'}
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
        <dialog
          ref={deleteDialog}
          aria-labelledby={`delete-listing-title-${intent.id}`}
          onClose={() => setConfirmingDelete(false)}
          onCancel={() => setConfirmingDelete(false)}
          className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60"
        >
          <h2 id={`delete-listing-title-${intent.id}`} className="text-lg font-semibold">Delete this listing?</h2>
          <p className="mt-2 text-sm text-slate-600">This can’t be undone.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirmingDelete(false) })}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {remove.isPending ? 'Deleting…' : 'Delete listing'}
            </button>
          </div>
        </dialog>
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
  const { open: choosingSeed, setOpen: setChoosingSeed } = useSeedDataDialog()
  const [scenarioId, setScenarioId] = useState('')
  const seedDialog = useRef<HTMLDialogElement>(null)
  const { up } = useLive()
  const queryClient = useQueryClient()
  const scenarios = useQuery({ queryKey: ['seed-options'], queryFn: () => api.seedOptions(), enabled: choosingSeed })
  const seed = useMutation({
    mutationFn: (id: string) => api.loadSeed(id),
    onSuccess: () => {
      setChoosingSeed(false)
      void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
      void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
    },
  })
  useEffect(() => {
    if (choosingSeed) seedDialog.current?.showModal()
    else seedDialog.current?.close()
  }, [choosingSeed])
  const query = useQuery({ queryKey: ['mine-intents'], queryFn: () => api.myIntents(), refetchInterval: pollWhenDown(up) })
  return (
    <section aria-label="Your listings" className="dashboard-panel panel-mine flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-900/10 px-4 py-4">
        <h2 className="text-lg font-semibold">Your listings</h2>
      </div>
      <dialog
        ref={seedDialog}
        id="seed-picker"
        aria-labelledby="seed-picker-title"
        onClose={() => { setChoosingSeed(false); seed.reset() }}
        onCancel={(event) => { if (seed.isPending) event.preventDefault() }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id="seed-picker-title" className="text-lg font-semibold">Load seed data</h3>
          <button type="button" aria-label="Close seed picker" disabled={seed.isPending} onClick={() => setChoosingSeed(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault()
          const selected = scenarioId || scenarios.data?.[0]?.id
          if (selected) seed.mutate(selected)
        }}>
          <label htmlFor="seed-dataset" className="block text-xs font-medium">Seed dataset</label>
          {scenarios.isPending && <p className="text-xs text-slate-600">Loading datasets...</p>}
          {scenarios.isError && <p role="alert" className="text-xs text-red-600">{errorMessage(scenarios.error)}</p>}
          {seed.isError && <p role="alert" className="text-xs text-red-600">{errorMessage(seed.error)}</p>}
          {scenarios.data && (
            <>
              <select id="seed-dataset" value={scenarioId || scenarios.data[0]?.id || ''} onChange={(event) => setScenarioId(event.target.value)} disabled={seed.isPending} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs">
                {scenarios.data.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
              </select>
              <p className="text-xs text-slate-600">{scenarios.data.find((scenario) => scenario.id === (scenarioId || scenarios.data[0]?.id))?.description}</p>
              <p className="text-xs text-amber-900">Replaces edward, kat, and dawg's current listings.</p>
              <button disabled={seed.isPending || scenarios.data.length === 0} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50">
                {seed.isPending ? 'Loading...' : 'Load selected dataset'}
              </button>
            </>
          )}
        </form>
      </dialog>
      <div role="region" aria-label="Your listing list" tabIndex={0} className="intent-scroll mx-3 my-3 min-h-0 flex-1 overflow-y-scroll rounded-xl border border-amber-900/15 bg-white/25 p-2">
      {query.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(query.error)}</p>}
      {query.data?.length === 0 && <p className="text-sm text-slate-500">Nothing posted yet.</p>}
      <ul className="space-y-1.5">{query.data?.map((intent) => <IntentRow key={intent.id} intent={intent} onDraft={setDraft} />)}</ul>
      </div>
      <NewIntent draft={draft} setDraft={setDraft} />
    </section>
  )
}
