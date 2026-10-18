import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api/context'
import { errorMessage } from '../lib/format'
import { useContactSummary } from '../useContactSummary'

export function ContactGate({ children }: { children: React.ReactNode }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { editing, setEditing, value, setValue } = useContactSummary()
  const query = useQuery({ queryKey: ['contact'], queryFn: () => api.contact() })
  const dialog = useRef<HTMLDialogElement>(null)
  const save = useMutation({
    mutationFn: (contact: string) => api.setContact(contact),
    onSuccess: (contact) => {
      queryClient.setQueryData(['contact'], contact)
      setEditing(false)
      setValue('')
    },
  })
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (editing && query.data) element.showModal()
    else element.close()
  }, [editing, query.data])
  const contactForm = (
    <>
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
        {query.data ? 'Save' : 'Continue'}
      </button>
    </>
  )
  if (query.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (query.data) {
    return (
      <>
        {children}
        <dialog
          ref={dialog}
          aria-labelledby="contact-dialog-title"
          onClose={() => setEditing(false)}
          onCancel={() => setEditing(false)}
          className="m-auto w-[calc(100%_-_2rem)] max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60"
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (value.trim()) save.mutate(value)
            }}
          >
            <h2 id="contact-dialog-title" className="text-lg font-semibold">Edit your contact</h2>
            {contactForm}
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setEditing(false)}
              className="ml-2 text-sm underline disabled:opacity-50"
            >
              Cancel
            </button>
          </form>
        </dialog>
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
      {contactForm}
    </form>
  )
}
