import { createContext } from 'react'

export type ContactSummaryContextValue = {
  editing: boolean
  setEditing: (editing: boolean) => void
  value: string
  setValue: (value: string) => void
}

export const ContactSummaryContext = createContext<ContactSummaryContextValue | null>(null)
