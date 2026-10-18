import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react'
import { useMemo } from 'react'
import { ApiContext } from './api/context'
import { createHttpApi } from './api/client'
import { createMockApi, isMock } from './api/mock'
import { Dashboard } from './Dashboard'
import { ContactGate } from './panels/ContactGate'

function Shell({ right, children }: { right: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-3">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Beehive</h1>
        <div className="flex items-center gap-2">{right}</div>
      </header>
      <main>{children}</main>
    </div>
  )
}

function SignedInApp() {
  const { getToken } = useAuth()
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
      <Shell right={<span className="text-xs text-amber-700">mock data</span>}>
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
            <UserButton />
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
