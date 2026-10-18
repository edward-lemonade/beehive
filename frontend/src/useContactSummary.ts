import { useContext } from 'react'
import { ContactSummaryContext } from './ContactSummaryContext'

export function useContactSummary() {
  const context = useContext(ContactSummaryContext)
  if (!context) throw new Error('useContactSummary must be used inside a ContactSummaryProvider')
  return context
}
