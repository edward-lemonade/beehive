import type { Item } from '../contracts'

export const money = (cents: number): string => {
  const dollars = cents / 100
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`
}

export const itemText = (item: Item): string =>
  item.kind === 'cash'
    ? item.amountCents !== undefined ? `${money(item.amountCents)} cash` : 'negotiable'
    : `${item.qty > 1 ? `${item.qty}× ` : ''}${item.label}`

export function countdown(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null) return null
  const ms = expiresAt - now
  if (ms <= 0) return 'expired'
  const minutes = Math.floor(ms / 60_000)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
  return `${minutes}m left`
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong')

/** Pulls the first dollar amount out of free text such as "Does $280 work?". */
export function dollarsToCents(text: string): number | null {
  const match = /(\d+(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})/.exec(text)
  if (!match) return null
  const dollars = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null
}
