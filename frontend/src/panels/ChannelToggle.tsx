import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { errorMessage } from '../lib/format'

export function ChannelToggle() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [phone, setPhone] = useState('')
  const [linkInfo, setLinkInfo] = useState<{ code: string; phoneNumber: string } | null>(null)
  const query = useQuery({
    queryKey: ['channel'],
    queryFn: () => api.channel(),
    refetchInterval: linkInfo ? 3000 : false,
  })
  useEffect(() => {
    if (query.data?.phoneLinked && linkInfo) {
      setLinkInfo(null)
      setAsking(false)
      setPhone('')
    }
  }, [linkInfo, query.data?.phoneLinked])
  const change = useMutation({
    mutationFn: async (next: { channel: 'app' | 'sms'; phone?: string }) => {
      if (next.phone) {
        await api.setPhone(next.phone)
        return { state: await api.channel(), linkInfo: await api.requestPhoneLink() }
      }
      return { state: await api.setChannel(next.channel), linkInfo: null }
    },
    onSuccess: ({ state, linkInfo: nextLinkInfo }) => {
      queryClient.setQueryData(['channel'], state)
      setLinkInfo(nextLinkInfo)
      if (!nextLinkInfo) {
        setAsking(false)
        setPhone('')
      }
    },
  })

  const channel = query.data?.channel ?? 'app'
  const choose = (next: 'app' | 'sms') => {
    if (next === channel) return
    if (next === 'sms' && !query.data?.phoneLinked) return setAsking(true)
    setAsking(false)
    change.mutate({ channel: next })
  }
  const button = (name: 'app' | 'sms', label: string) => (
    <button
      onClick={() => choose(name)}
      aria-pressed={channel === name}
      disabled={change.isPending}
      className={`px-2 py-0.5 text-xs ${channel === name ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="text-xs">
      <div role="group" aria-label="Where your agent talks to you" className="inline-flex overflow-hidden rounded border border-slate-300">
        {button('app', 'Chat')}
        {button('sms', 'SMS')}
      </div>
      {asking && (
        linkInfo ? (
          <div className="mt-2 max-w-64 text-slate-600">
            <p>Text <strong>{linkInfo.code}</strong> to <strong>{linkInfo.phoneNumber}</strong> to verify your number. This panel will switch to SMS when it is confirmed.</p>
            <div className="mt-1 flex gap-3">
              <button type="button" disabled={change.isPending} onClick={() => phone.trim() && change.mutate({ channel: 'sms', phone })} className="text-slate-500 underline disabled:opacity-50">Resend code</button>
              <button type="button" onClick={() => { setLinkInfo(null); setPhone('') }} className="text-slate-500 underline">Change number</button>
              <button type="button" onClick={() => { setLinkInfo(null); setAsking(false); setPhone('') }} className="text-slate-500 underline">Cancel</button>
            </div>
          </div>
        ) : (
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (phone.trim()) change.mutate({ channel: 'sms', phone })
            }}
          >
            <input aria-label="Phone number" placeholder="+1 555 010 0100" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-0.5" />
            <button disabled={change.isPending || !phone.trim()} className="rounded bg-slate-900 px-2 py-0.5 text-white disabled:opacity-50">Verify</button>
          </form>
        )
      )}
      {change.isError && <p role="alert" className="mt-1 text-red-600">{errorMessage(change.error)}</p>}
    </div>
  )
}
