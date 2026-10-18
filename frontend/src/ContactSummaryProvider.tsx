import { useState, type ReactNode } from 'react'
import { ContactSummaryContext } from './ContactSummaryContext'

export function ContactSummaryProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  return (
    <ContactSummaryContext.Provider value={{ editing, setEditing, value, setValue }}>
      {children}
    </ContactSummaryContext.Provider>
  )
}
