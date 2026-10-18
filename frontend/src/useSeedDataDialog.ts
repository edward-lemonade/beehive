import { useContext } from 'react'
import { SeedDataContext } from './SeedDataContext'

export function useSeedDataDialog() {
  const context = useContext(SeedDataContext)
  if (!context) throw new Error('useSeedDataDialog must be used inside a SeedDataProvider')
  return context
}
