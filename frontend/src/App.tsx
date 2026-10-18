import { Show, SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/react'
import { useEffect, useMemo } from 'react'
import { Sentry } from './lib/sentry'
import { ApiContext } from './api/context'
import { createHttpApi } from './api/client'
import { createMockApi, isMock } from './api/mock'
import { Dashboard } from './Dashboard'
import { ContactGate } from './panels/ContactGate'

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
        <div className="flex items-center gap-3">{right}</div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col p-4 lg:min-h-0 lg:p-6">{children}</main>
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
      <ContactGate>
        <Dashboard />
      </ContactGate>
    </ApiContext.Provider>
  )
}

function App() {
  const mock = useMemo(() => (isMock ? createMockApi() : null), [])
  if (mock) {
    return (
      <Shell right={
        <>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">mock data</span>
          <span role="img" aria-label="Demo profile picture" className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-amber-100 shadow-sm ring-1 ring-amber-200">
            <svg aria-hidden="true" viewBox="0 0 40 40" className="h-full w-full" fill="none">
              <circle cx="20" cy="15" r="7" fill="#b7794b" />
              <path d="M6 40v-5a14 14 0 0 1 28 0v5" fill="#647c68" />
            </svg>
          </span>
        </>
      }>
        <ApiContext.Provider value={mock}>
          <Dashboard />
        </ApiContext.Provider>
      </Shell>
    )
  }
  return (
    <Shell
      right={
        <>
          <Show when="signed-out">
            <SignInButton />
            <SignUpButton />
          </Show>
          <Show when="signed-in">
            <UserButton appearance={{ elements: { avatarBox: 'h-10 w-10' } }} />
          </Show>
        </>
      }
    >
      <Show when="signed-out">
        <p className="text-sm text-slate-600">Sign in to post intents and trade.</p>
      </Show>
      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </Shell>
  )
}

export default App
