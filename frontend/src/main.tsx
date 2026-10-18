import { Sentry } from './lib/sentry'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isMock } from './api/mock'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2000 } } })

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="p-6 text-sm text-red-700">Something broke. It has been reported; reload to try again.</p>}>
      <QueryClientProvider client={queryClient}>
        {isMock ? (
          <App />
        ) : (
          <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
            <App />
          </ClerkProvider>
        )}
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
