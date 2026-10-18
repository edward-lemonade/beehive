import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isMock } from './api/mock'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isMock ? (
        <App />
      ) : (
        <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
          <App />
        </ClerkProvider>
      )}
    </QueryClientProvider>
  </StrictMode>,
)
