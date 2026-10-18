import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/context'
import type { IntentPublic } from '../contracts'
import { pollWhenDown, useLive } from '../hooks/liveContext'
import { errorMessage, itemText } from '../lib/format'
import { MessageAgent } from '../panels/MessageAgent'

const PREVIEW = 120

function Avatar({ url, handle }: { url?: string | null; handle: string }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
      {handle.charAt(0).toUpperCase()}
    </span>
  )
}

export function IntentCard({ intent, own }: { intent: IntentPublic; own: boolean }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const relevance = useQuery({
    queryKey: ['relevant', intent.intentId],
    queryFn: () => api.relevant(intent.intentId),
    enabled: open && !own,
  })

  const text = intent.freeText
  const shown = open || text.length <= PREVIEW ? text : `${text.slice(0, PREVIEW)}…`

  return (
    <li
      data-testid="intent-card"
      className={`rounded-lg border px-3 py-2 ${own ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white/90'}`}
    >
      <button className="w-full text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-sm">
          <Avatar url={intent.ownerImageUrl} handle={intent.ownerHandle} />
          <span className="font-medium">{intent.ownerHandle}</span>
          <span className="rounded bg-slate-100 px-1.5 text-xs uppercase text-slate-600">{intent.tier}</span>
          {own && <span className="text-xs text-emerald-700">Yours</span>}
        </span>
        <span className={`mt-1 wrap-break-word text-sm leading-5 text-slate-800 ${open ? 'block' : 'line-clamp-2'}`}>{shown}</span>
      </button>
      {open && (
        <div className="mt-2 text-xs text-slate-500">
          <p>user-written</p>
          <p className="mt-1">
            Gives: {intent.give.map(itemText).join(', ') || 'nothing'}. Wants:{' '}
            {intent.want.map((w) => w.anyOf.map(itemText).join(' or ')).join(', ') || 'anything'}.
          </p>
          {!own && relevance.isPending && <p className="mt-2">Checking…</p>}
          {!own && relevance.isError && <p role="alert" className="mt-2 text-red-600">{errorMessage(relevance.error)}</p>}
          {!own && relevance.data?.relevant && relevance.data.ownIntentId && (
            messaging ? (
              <MessageAgent ownIntentId={relevance.data.ownIntentId} targetIntentId={intent.intentId} onClose={() => setMessaging(false)} />
            ) : (
              <button onClick={() => setMessaging(true)} className="mt-2 rounded bg-slate-900 px-3 py-1 text-sm text-white">
                Message their agent
              </button>
            )
          )}
          {!own && relevance.data && !relevance.data.relevant && (
            <p className="mt-2 text-slate-500">Not a possible trade for your intents</p>
          )}
        </div>
      )}
    </li>
  )
}

export function PublicIntents() {
  const api = useApi()
  const { up } = useLive()
  const publicQuery = useQuery({ queryKey: ['public'], queryFn: () => api.publicIntents(), refetchInterval: pollWhenDown(up) })
  const mine = useQuery({ queryKey: ['mine-intents'], queryFn: () => api.myIntents(), refetchInterval: pollWhenDown(up) })
  const ownIds = new Set((mine.data ?? []).map((i) => i.id))
  const otherListings = publicQuery.data?.filter((intent) => !ownIds.has(intent.intentId))

  return (
    <section aria-label="Other listings" className="dashboard-panel panel-feed flex h-[calc(100dvh-12rem)] min-h-[480px] flex-col lg:h-full lg:min-h-0">
      <h2 className="shrink-0 border-b border-blue-900/10 px-4 py-4 text-lg font-semibold">Other listings</h2>
      <div role="region" aria-label="Other listings list" tabIndex={0} className="intent-scroll mx-3 my-3 min-h-0 flex-1 overflow-y-scroll rounded-xl border border-blue-900/15 bg-white/25 p-2">
      {publicQuery.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {publicQuery.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(publicQuery.error)}</p>}
      {otherListings?.length === 0 && <p className="text-sm text-slate-500">No other listings yet.</p>}
      <ul className="space-y-1.5">
        {otherListings?.map((intent) => (
          <IntentCard key={intent.intentId} intent={intent} own={false} />
        ))}
      </ul>
      </div>
    </section>
  )
}
