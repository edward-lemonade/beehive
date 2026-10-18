import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { ArrangementAction } from '../api/client'
import type { ActionResult, MineEntry } from '../api/schemas'
import { countdown, dollarsToCents, errorMessage, itemText, money } from '../lib/format'

function Checklist({ entry }: { entry: MineEntry }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: ({ stepId, done }: { stepId: string; done: boolean }) => api.setStep(entry.terms.arrangementId, stepId, done),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['arrangements'] }),
  })
  if (!entry.checklist) return null
  const contacts = [...new Map(entry.checklist.filter((s) => s.contact).map((s) => [s.counterpartyHandle, s.contact])).entries()]
  return (
    <div className="mt-2">
      {contacts.length > 0 && (
        <p className="text-xs text-slate-600">
          Contacts: {contacts.map(([handle, contact]) => `${handle} ${contact}`).join(' · ')}
        </p>
      )}
      <ul className="mt-1 space-y-1">
        {entry.checklist.map((step) => (
          <li key={step.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={step.done}
                disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ stepId: step.id, done: e.target.checked })}
              />
              <span className={step.done ? 'line-through text-slate-400' : ''}>{step.description}</span>
            </label>
          </li>
        ))}
      </ul>
      {toggle.isError && <p role="alert" className="text-xs text-red-600">{errorMessage(toggle.error)}</p>}
    </div>
  )
}

export type CardOutcome = { action: ArrangementAction; targetCents?: number; result: ActionResult }

export function ApprovalCard({ entry, onOutcome }: { entry: MineEntry; onOutcome?: (outcome: CardOutcome) => void }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const t = entry.terms
  const [now, setNow] = useState(() => Date.now())
  const [target, setTarget] = useState('')
  const [negotiating, setNegotiating] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const act = useMutation({
    mutationFn: (args: { action: ArrangementAction; targetCents?: number }) =>
      api.arrangementAction(t.arrangementId, args.action, args.targetCents !== undefined ? { targetCents: args.targetCents } : undefined),
    onSuccess: (result, args) => onOutcome?.({ action: args.action, ...(args.targetCents !== undefined ? { targetCents: args.targetCents } : {}), result }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['arrangements'] }),
  })

  const deadline = t.approval === 'requested' ? countdown(t.expiresAt, now) : null
  const committed = t.state === 'committed'
  const run = (action: ArrangementAction) => act.mutate({ action })

  return (
    <li className="rounded border border-slate-200 bg-white p-3 text-sm" data-testid="approval-card">
      <div className="flex items-center justify-between">
        <span className="rounded bg-slate-100 px-1.5 text-xs uppercase">{committed ? 'committed' : t.approval}</span>
        <span className="text-xs text-slate-500">{t.grade === 'exact' ? 'Exact match' : 'Within tolerance'}</span>
      </div>
      <ul className="mt-2 space-y-0.5">
        {t.gives.map((g, i) => <li key={`g${i}`}>Give {itemText(g.item)} to {g.toHandle}</li>)}
        {t.gets.map((g, i) => <li key={`r${i}`}>Get {itemText(g.item)} from {g.fromHandle}</li>)}
        {t.cashOut.map((c, i) => <li key={`o${i}`}>Pay {money(c.amountCents)} to {c.toHandle}</li>)}
        {t.cashIn.map((c, i) => <li key={`i${i}`}>Receive {money(c.amountCents)} from {c.fromHandle}</li>)}
      </ul>
      <p className="mt-2 text-xs text-slate-600">
        Net {money(t.netCents)}
        {t.declaredNetCents !== null && ` (you asked for ${money(t.declaredNetCents)})`}
      </p>
      {t.otherParticipants > 0 && (
        <p className="text-xs text-slate-500">
          Includes {t.otherParticipants} other participant{t.otherParticipants === 1 ? '' : 's'} you will not deal with
        </p>
      )}
      {deadline && <p className="text-xs text-slate-500">Respond: {deadline}</p>}

      {committed ? (
        <Checklist entry={entry} />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {t.approval === 'requested' && (
            <>
              <button disabled={act.isPending} onClick={() => run('approve')} className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50">Approve</button>
              <button disabled={act.isPending} onClick={() => run('decline')} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">Decline</button>
              <button disabled={act.isPending} onClick={() => run('decline-withdraw')} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">Decline and withdraw</button>
            </>
          )}
          {t.approval === 'approved' && (
            <button disabled={act.isPending} onClick={() => run('retract')} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">Retract approval</button>
          )}
          <button onClick={() => setNegotiating((v) => !v)} className="rounded border border-slate-300 px-3 py-1">Negotiate further</button>
        </div>
      )}
      {negotiating && !committed && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const cents = dollarsToCents(target)
            act.mutate({ action: 'negotiate-further', ...(cents !== null ? { targetCents: cents } : {}) }, { onSuccess: () => { setNegotiating(false); setTarget('') } })
          }}
        >
          <input
            aria-label="Message to their agent"
            placeholder="Does $280 work?"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
          />
          <button disabled={act.isPending} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">Ask</button>
        </form>
      )}
      {act.isError && <p role="alert" className="mt-2 text-xs text-red-600">{errorMessage(act.error)}</p>}
    </li>
  )
}
