import { createContext, useContext } from 'react'
import type { StreamEvent } from '../api/stream'
import * as speech from '../lib/agentSpeech'
import { money } from '../lib/format'
import type { MyIntent } from '../api/schemas'

export type FeedEntry = { id: number; at: number; text: string; speech: boolean }

export type ChatMessage = {
  id: number
  at: number
  mine: boolean
  kind: 'offer' | 'accept' | 'walk' | 'say'
  amountCents: number | null
  text: string | null
}
export type Conversation = { key: string; handle: string; mineText: string; theirText: string; messages: ChatMessage[]; updatedAt: number }

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
  conversations: Conversation[]
  chat: ChatMsg[]
  postChat: (message: ChatInput) => void
  clearChat: () => void
}

export const LiveContext = createContext<Live>({ up: false, feed: [], conversations: [], chat: [], postChat: () => {}, clearChat: () => {} })
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
          const side = d.side === 'receiver' ? 'receiver' : 'payer'
          const cents = typeof d.amountCents === 'number' ? d.amountCents : undefined
          return { from: 'agent', text: speech.needsYourCall(side, handleOf(d), cents), ...(aid ? { key: `need:${aid}:${cents}` } : {}) }
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
        case 'committed': return { text: 'Arrangement committed. Check the checklist', speech: false }
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

const roundKey = (d: Record<string, unknown>): string =>
  [d.linkId, d.round, d.kind, d.fromIntentId, d.amountCents ?? '', d.text ?? ''].join('|')

/** Rebuilds conversations from stored history, then replays live rounds that history does not already contain. */
export function mergeHistory(
  history: Array<{ at: number } & Record<string, unknown>>,
  live: Array<{ event: StreamEvent; id: number; at: number }>,
): Conversation[] {
  let convs: Conversation[] = []
  const known = new Set<string>()
  history.forEach((h, i) => {
    known.add(roundKey(h))
    convs = addRound(convs, { type: 'negotiation.round', data: h }, -(history.length - i), h.at)
  })
  for (const l of live) {
    if (known.has(roundKey(l.event.data))) continue
    convs = addRound(convs, l.event, l.id, l.at)
  }
  return convs
}

export const CONVERSATION_CAP = 50
export const MESSAGE_CAP = 200

const KINDS = new Set(['offer', 'accept', 'walk', 'say'])

/** Folds one negotiation.round event into the per-counterparty conversations. */
export function addRound(prev: Conversation[], event: StreamEvent, id: number, at: number): Conversation[] {
  const d = event.data
  if (event.type !== 'negotiation.round' || typeof d.kind !== 'string' || !KINDS.has(d.kind)) return prev
  const mine = d.fromMine === true
  const myId = String((mine ? d.fromIntentId : d.toIntentId) ?? '')
  const theirId = String((mine ? d.toIntentId : d.fromIntentId) ?? '')
  const key = myId && theirId ? `${myId}:${theirId}` : String(d.linkId ?? '')
  if (!key) return prev
  const mineText = String((mine ? d.fromText : d.toText) ?? '')
  const theirText = String((mine ? d.toText : d.fromText) ?? '')
  const handle = String((mine ? d.toHandle : d.fromHandle) ?? 'unknown')
  const kind = d.kind as ChatMessage['kind']
  const amountCents = typeof d.amountCents === 'number' ? d.amountCents : null
  const text = typeof d.text === 'string' ? d.text : null

  const existing = prev.find((c) => c.key === key)
  const messages = existing ? [...existing.messages] : []
  const last = messages[messages.length - 1]
  if (kind === 'say' && last && last.mine === mine && last.kind !== 'say' && last.text === null) {
    messages[messages.length - 1] = { ...last, text }
  } else {
    messages.push({ id, at, mine, kind, amountCents, text })
  }
  const next: Conversation = { key, handle, mineText, theirText, messages: messages.slice(-MESSAGE_CAP), updatedAt: at }
  return [next, ...prev.filter((c) => c.key !== key)].slice(0, CONVERSATION_CAP)
}
