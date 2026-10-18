import { createContext } from 'react'

export type SeedDataContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

export const SeedDataContext = createContext<SeedDataContextValue | null>(null)
