import { createContext, useContext } from 'react'
import type { StreamEvent } from '../api/stream'
import * as speech from '../lib/agentSpeech'
import { money } from '../lib/format'
import type { MyIntent } from '../api/schemas'

export type FeedEntry = { id: number; at: number; text: string; speech: boolean }

export type ChatMsg = {
  id: number
  at: number
  from: 'agent' | 'me'
  text: string
  key?: string
  arrangementId?: string
  suggest?: { arrangementId: string; cents: number }
}
export type ChatInput = Omit<ChatMsg, 'id' | 'at'>

type Live = {
  up: boolean
  feed: FeedEntry[]
  chat: ChatMsg[]
  postChat: (message: ChatInput) => void
  clearChat: () => void
}

export const LiveContext = createContext<Live>({ up: false, feed: [], chat: [], postChat: () => {}, clearChat: () => {} })
export const useLive = (): Live => useContext(LiveContext)

export const FEED_CAP = 100
export const CHAT_CAP = 300

/** Appends a chat message, skipping one whose key is already present. */
export function appendChat(prev: ChatMsg[], message: ChatInput, id: number, at: number): ChatMsg[] {
  if (message.key && prev.some((m) => m.key === message.key)) return prev
  return [...prev, { ...message, id, at }].slice(-CHAT_CAP)
}

const handleOf = (d: Record<string, unknown>): string => (typeof d.counterpartHandle === 'string' ? d.counterpartHandle : 'Their agent')

/** What your agent says to you when a stream event arrives. Matches and cards are added separately from the arrangements list. */
export function chatFor(event: StreamEvent, intents: MyIntent[] | undefined): ChatInput | null {
  const d = event.data
  const aid = typeof d.arrangementId === 'string' ? d.arrangementId : undefined
  switch (event.type) {
    case 'notify':
      switch (d.kind) {
        case 'needs_user': {
          // Arrangement updates are announced from persisted terms, not an in-flight negotiation event.
          if (aid) return null
          const side = d.side === 'receiver' ? 'receiver' : 'payer'
          const cents = typeof d.amountCents === 'number' ? d.amountCents : undefined
          return { from: 'agent', text: speech.needsYourCall(side, handleOf(d), cents, d.multi === true), ...(aid ? { key: `need:${aid}:${cents}` } : {}) }
        }
        case 'nothing_found': {
          const mine = intents?.find((i) => i.id === d.intentId)
          return { from: 'agent', text: speech.nothingFound(speech.roleOf(mine?.public)), key: `nothing:${String(d.intentId)}` }
        }
        default: return null
      }
    case 'arrangement.dissolved': return aid ? { from: 'agent', text: speech.dissolved(), key: `dissolved:${aid}` } : null
    case 'slot.vacated': return aid ? { from: 'agent', text: speech.vacated(), key: `vacated:${aid}` } : null
    default: return null
  }
}

export function describe(event: StreamEvent): { text: string; speech: boolean } | null {
  const d = event.data
  switch (event.type) {
    case 'negotiation.round': return null
    case 'notify':
      switch (d.kind) {
        case 'approval_request': return { text: 'An arrangement needs your approval', speech: false }
        case 'committed': return { text: 'Arrangement committed. Contact details are in the chat', speech: false }
        case 'needs_user': if (d.side === 'receiver') return { text: `${typeof d.counterpartHandle === 'string' ? d.counterpartHandle : 'Their agent'} offers ${typeof d.amountCents === 'number' ? money(d.amountCents) : 'a lower price'}, below your ask. Your agent needs your call`, speech: false }
          return { text: `${typeof d.counterpartHandle === 'string' ? d.counterpartHandle : 'Their agent'} holds at ${typeof d.amountCents === 'number' ? money(d.amountCents) : 'a price'}. Your agent needs your call`, speech: false }
        case 'dissolved': return { text: 'An arrangement you approved was dissolved', speech: false }
        case 'nothing_found': return { text: 'No match found yet. Your agent is still watching', speech: false }
        case 'near_miss': return { text: `Near miss: ${typeof d.gapCents === 'number' ? money(d.gapCents) : 'a small'} gap`, speech: false }
        default: return null
      }
    case 'arrangement.proposed': return { text: 'Arrangement proposed', speech: false }
    case 'slot.vacated': return { text: 'A participant dropped out. Looking for a replacement', speech: false }
    case 'arrangement.dissolved': return { text: 'Arrangement dissolved', speech: false }
    case 'arrangement.committed': return { text: 'Arrangement committed', speech: false }
    default: return null
  }
}

/** Polling interval used while the stream is down. */
export const pollWhenDown = (up: boolean): number | false => (up ? false : 10_000)
