import { Show, SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sentry } from './lib/sentry'
import { ApiContext, useApi } from './api/context'
import { createHttpApi } from './api/client'
import { createMockApi, isMock } from './api/mock'
import { Dashboard } from './Dashboard'
import { ContactGate } from './panels/ContactGate'
import { SeedDataProvider } from './SeedDataProvider'
import { useSeedDataDialog } from './useSeedDataDialog'
import { ContactSummaryProvider } from './ContactSummaryProvider'
import { useContactSummary } from './useContactSummary'

function Shell({ right, children }: { right: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-[640px]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6">
              <path d="m12 2 8.7 5v10L12 22l-8.7-5V7L12 2Z" />
              <path d="m12 7 4.3 2.5v5L12 17l-4.3-2.5v-5L12 7Z" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Beehive</h1>
            <p className="text-xs text-slate-500">Effortless trades start here.</p>
          </div>
        </div>
        <div className="flex min-w-0 max-w-[65%] flex-wrap items-center justify-end gap-2 sm:max-w-none sm:gap-3">{right}</div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col p-4 lg:min-h-0 lg:p-6">{children}</main>
    </div>
  )
}

function SeedDataButton() {
  const { open, setOpen } = useSeedDataDialog()
  return import.meta.env.DEV ? (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-controls="seed-picker"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="rounded-lg border border-amber-900/15 bg-white/70 px-2 py-1 text-xs"
    >
      Load seed data
    </button>
  ) : null
}

function DealContacts() {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const query = useQuery({ queryKey: ['arrangements'], queryFn: () => api.arrangements() })
  const contacts = [...new Map(
    (query.data ?? [])
      .filter((entry) => entry.terms.state === 'committed' && entry.terms.approval !== 'declined')
      .flatMap((entry) => entry.contacts ?? [])
      .filter((contact) => contact.contact)
      .map((contact) => [`${contact.handle}:${contact.contact}`, contact]),
  ).values()]

  if (contacts.length === 0) return null
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="deal-contacts"
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg border border-amber-900/15 bg-white/70 px-2 py-1 text-xs"
      >
        Deal contacts
      </button>
      {open && (
        <div id="deal-contacts" className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-slate-300 bg-white p-3 text-slate-900 shadow-xl">
          <ul className="space-y-2 text-sm">
            {contacts.map((contact) => (
              <li key={`${contact.handle}:${contact.contact}`}>
                <span className="font-medium">{contact.handle}</span>
                <span className="ml-2 break-all">{contact.contact}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ProfileContact() {
  const api = useApi()
  const query = useQuery({ queryKey: ['contact'], queryFn: () => api.contact() })
  const { setEditing, setValue } = useContactSummary()
  const contact = query.data
  if (!contact) return null
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs">
      <span className="hidden text-slate-500 sm:inline">Your contact:</span>
      <span className="max-w-[28vw] truncate sm:max-w-48" title={contact}>{contact}</span>
      <button type="button" onClick={() => { setValue(contact); setEditing(true) }} className="text-amber-300 underline">Edit</button>
    </div>
  )
}

function SignedInApp() {
  const { getToken } = useAuth()
  const { user } = useUser()
  // Lets a replay or frontend error be found by user; id and username only, never email or phone.
  useEffect(() => {
    Sentry.setUser(user ? { id: user.id, username: user.username ?? undefined } : null)
  }, [user])
  const api = useMemo(() => createHttpApi(() => getToken()), [getToken])
  return (
    <ApiContext.Provider value={api}>
      <ContactSummaryProvider>
        <Shell right={
          <>
            <SeedDataButton />
            <DealContacts />
            <ProfileContact />
            <UserButton appearance={{ elements: { avatarBox: 'h-10 w-10' } }} />
          </>
        }>
          <ContactGate>
            <Dashboard />
          </ContactGate>
        </Shell>
      </ContactSummaryProvider>
    </ApiContext.Provider>
  )
}

function AppContent() {
  const mock = useMemo(() => (isMock ? createMockApi() : null), [])
  if (mock) {
    return (
      <ApiContext.Provider value={mock}>
        <Shell right={
          <>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">mock data</span>
            <SeedDataButton />
            <DealContacts />
            <span role="img" aria-label="Demo profile picture" className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-amber-100 shadow-sm ring-1 ring-amber-200">
              <svg aria-hidden="true" viewBox="0 0 40 40" className="h-full w-full" fill="none">
                <circle cx="20" cy="15" r="7" fill="#b7794b" />
                <path d="M6 40v-5a14 14 0 0 1 28 0v5" fill="#647c68" />
              </svg>
            </span>
          </>
        }>
          <Dashboard />
        </Shell>
      </ApiContext.Provider>
    )
  }
  return (
    <>
      <Show when="signed-out">
        <main className="flex min-h-dvh items-center justify-center bg-amber-300 px-6 text-center text-amber-950">
          <div className="flex max-w-lg flex-col items-center">
            <span aria-hidden="true" className="mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-amber-950 text-amber-200 shadow-xl shadow-amber-900/20">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-11 w-11">
                <path d="m12 2 8.7 5v10L12 22l-8.7-5V7L12 2Z" />
                <path d="m12 7 4.3 2.5v5L12 17l-4.3-2.5v-5L12 7Z" />
              </svg>
            </span>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Beehive</h1>
            <p className="mt-3 text-base text-amber-950/75 sm:text-lg">Effortless trades start here.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <SignInButton>
                <button type="button" className="rounded-xl bg-amber-950 px-6 py-3 text-sm font-semibold text-amber-50 shadow-md shadow-amber-950/15 transition hover:bg-amber-900">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton>
                <button type="button" className="rounded-xl border border-amber-950/30 bg-amber-100/70 px-6 py-3 text-sm font-semibold text-amber-950 transition hover:bg-amber-100">
                  Sign up
                </button>
              </SignUpButton>
            </div>
          </div>
        </main>
      </Show>
      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </>
  )
}

function App() {
  const [open, setOpen] = useState(false)
  return (
    <SeedDataProvider value={{ open, setOpen }}>
      <AppContent />
    </SeedDataProvider>
  )
}

export default App
