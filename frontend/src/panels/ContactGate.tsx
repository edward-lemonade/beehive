import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/context'
import { errorMessage } from '../lib/format'

export function ContactGate({ children }: { children: React.ReactNode }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const query = useQuery({ queryKey: ['contact'], queryFn: () => api.contact() })
  const save = useMutation({
    mutationFn: (contact: string) => api.setContact(contact),
    onSuccess: (contact) => {
      queryClient.setQueryData(['contact'], contact)
      setEditing(false)
      setValue('')
    },
  })
  if (query.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (query.data && !editing) {
    return (
      <>
        <p className="mb-2 text-xs text-slate-500">
          Your contact, shared only after a deal: {query.data}{' '}
          <button className="underline" onClick={() => { setValue(query.data ?? ''); setEditing(true) }}>Edit</button>
        </p>
        {children}
      </>
    )
  }
  return (
    <form
      className="mx-auto mt-10 max-w-sm space-y-3 rounded border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) save.mutate(value)
      }}
    >
      <h2 className="font-semibold">How should people reach you?</h2>
      <p className="text-sm text-slate-600">
        Add an email or phone number. It stays private and is only shared with the other side once a deal is agreed, so you can finish it off the platform.
      </p>
      <input
        aria-label="Public contact"
        className="w-full rounded border border-slate-300 px-2 py-1"
        placeholder="you@example.com or +1 555 010 0100"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {save.isError && <p role="alert" className="text-xs text-red-600">{errorMessage(save.error)}</p>}
      <button disabled={save.isPending || !value.trim()} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
        {editing ? 'Save' : 'Continue'}
      </button>
      {editing && <button type="button" className="ml-2 text-sm underline" onClick={() => setEditing(false)}>Cancel</button>}
    </form>
  )
}
