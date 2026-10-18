import type { IntentPublic, Item } from '../contracts'
import { itemText, money } from './format'

export type Role = 'payer' | 'receiver'

/** The user is a buyer when they give cash, a seller when they want cash. */
export function roleOf(intent: Pick<IntentPublic, 'give' | 'want'> | undefined): Role | null {
  if (!intent) return null
  if (intent.give.some((g) => g.kind === 'cash')) return 'payer'
  if (intent.want.some((w) => w.anyOf.some((a) => a.kind === 'cash'))) return 'receiver'
  return null
}

/** Next price the agent would try: buyers go lower, sellers hold higher. */
export function nextSuggestion(cents: number, role: Role): number {
  const step = Math.max(500, Math.round(cents * 0.1 / 500) * 500)
  return Math.max(500, role === 'payer' ? cents - step : cents + step)
}

export const greeting = (): string =>
  "Hi! I'm your agent. Add what you want to trade in the New intent box and I'll look for matches and negotiate for you."

export function nothingFound(role: Role | null): string {
  if (role === 'receiver') return "I haven't found a buyer yet, and I'll keep watching. If you want a quicker deal, consider a lower price. Want me to update your listing?"
  if (role === 'payer') return "Nothing matches yet, and I'll keep watching. A slightly higher offer might get you more takers."
  return "Nothing matches yet, but I'll keep watching. Adjusting your price may help."
}

export const matchFound = (): string => 'Good news, I found a match. Here are the terms. Want me to lock it in?'

export function needsYourCall(side: 'payer' | 'receiver', handle: string, cents?: number): string {
  const price = cents !== undefined ? money(cents) : 'a different price'
  return side === 'receiver'
    ? `${handle} offered ${price}, which is below your ask. Should I take it, hold out, or counter? Tell me a price.`
    : `${handle} won't go below ${price}. Your listing doesn't set a price, so what's the most you'd pay?`
}

export const askedThem = (handle: string, cents?: number): string =>
  `I asked ${handle}${cents !== undefined ? ` if ${money(cents)} works` : ''}. They're checking with their user, so I'll tell you when they answer.`

export const couldNotChange = (): string => "That didn't go through, so the current price stands."

export const priceFinal = (handle: string, cents?: number): string =>
  `${handle} says ${cents !== undefined ? money(cents) : 'that price'} is final. They won't move.`

export function priceCameDown(handle: string, cents: number, role: Role): string {
  const next = nextSuggestion(cents, role)
  const verb = role === 'payer' ? 'lowered' : 'raised'
  return `${handle} ${verb} it to ${money(cents)}. Want me to try ${money(next)}?`
}

export const committed = (): string => "It's a deal. Contact each other directly to finish it off the platform."
export const dissolved = (): string => 'That arrangement fell through. I will keep looking.'
export const vacated = (): string => 'Someone dropped out of a deal you are part of. I am looking for a replacement.'
export const declined = (): string => "Okay, I've passed on that one."
export const retracted = (): string => "I've retracted your approval."
export const negotiating = (handle?: string): string => `Asking ${handle ?? 'their agent'} now…`

export function messageOutcome(status: string, cents: number | undefined): string {
  if (status === 'agreed' && cents !== undefined) return `They agreed to ${money(cents)}. I've set it up for your approval.`
  if (status === 'agreed') return "They agreed. I've set it up for your approval."
  if (status === 'awaiting_user') return 'They need to check with their user first. I will tell you what they say.'
  return `That didn't work out (${status.replace(/_/g, ' ')}). I can try a different price.`
}

export function draftSummary(give: string[], want: string[]): string {
  return `Here's what I understood. You give ${give.join(', ') || 'nothing'} and want ${want.join(', ') || 'anything'}. Post it?`
}

export function draftMessage(draft: { question: string | null; parsed: { give: Item[]; want: Array<{ anyOf: Item[] }> } }): string {
  if (draft.question) return draft.question
  return draftSummary(draft.parsed.give.map(itemText), draft.parsed.want.map((w) => w.anyOf.map(itemText).join(' or ')))
}
