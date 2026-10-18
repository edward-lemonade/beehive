import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/context'
import { useLive } from '../hooks/liveContext'
import { messageOutcome } from '../lib/agentSpeech'
import { dollarsToCents, errorMessage, money } from '../lib/format'

type Props = { ownIntentId: string; targetIntentId: string; onClose: () => void }

export function MessageAgent({ ownIntentId, targetIntentId, onClose }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { postChat } = useLive()
  const [price, setPrice] = useState('')

  const send = useMutation({
    mutationFn: () => {
      return api.negotiate(ownIntentId, targetIntentId, dollarsToCents(price) ?? undefined)
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
      const cents = dollarsToCents(price)
      postChat({ from: 'me', text: cents !== null ? `Message their agent: could you do ${money(cents)}?` : 'Message their agent.' })
      postChat({ from: 'agent', text: messageOutcome(result.status, result.amountCents) })
    },
  })

  const result = send.data
  return (
    <div role="dialog" aria-label="Message their agent" className="mt-2 rounded border border-slate-300 bg-white p-3">
      <p className="text-sm font-medium">Message their agent</p>
      <label className="mt-2 block text-sm">
        Message (optional, mention a price like $280 to counter)
        <input
          placeholder="Does $280 work?"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {send.isError && <p role="alert" className="mt-2 text-sm text-red-600">{errorMessage(send.error)}</p>}
      {result && (
        <p className="mt-2 text-sm text-slate-700">
          {messageOutcome(result.status, result.amountCents)}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button disabled={send.isPending} onClick={() => send.mutate()} className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-sm">Close</button>
      </div>
    </div>
  )
}
