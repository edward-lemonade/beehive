import type { ReactNode } from 'react'
import { SeedDataContext, type SeedDataContextValue } from './SeedDataContext'

export function SeedDataProvider({ value, children }: { value: SeedDataContextValue; children: ReactNode }) {
  return <SeedDataContext.Provider value={value}>{children}</SeedDataContext.Provider>
}
