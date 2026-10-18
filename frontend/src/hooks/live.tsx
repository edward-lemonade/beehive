import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MyIntent } from '../api/schemas'
import { useApi } from '../api/context'
import type { StreamEvent } from '../api/stream'
import { addRound, appendChat, chatFor, describe, mergeHistory, FEED_CAP, LiveContext, type ChatInput, type ChatMsg, type Conversation, type FeedEntry } from './liveContext'

const PUBLIC_EVENTS = new Set(['intent.opened', 'intent.updated', 'intent.closed'])

export function LiveProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [up, setUp] = useState(false)
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const chatSeq = useRef(0)
  const postChat = useCallback((message: ChatInput) => {
    chatSeq.current += 1
    const id = chatSeq.current
    setChat((prev) => appendChat(prev, message, id, Date.now()))
  }, [])

  const clearChat = useCallback(() => setChat([]), [])

  useEffect(() => {
    let seq = 0
    let historyLoaded = false
    const liveRounds: Array<{ event: StreamEvent; id: number; at: number }> = []
    api.history().then(
      (history) => {
        historyLoaded = true
        setConversations(mergeHistory(history, liveRounds))
      },
      () => { historyLoaded = true },
    )
    const unsubscribe = api.subscribe({
      onStatus: setUp,
      onEvent: (event) => {
        if (PUBLIC_EVENTS.has(event.type)) {
          void queryClient.invalidateQueries({ queryKey: ['public'] })
          void queryClient.invalidateQueries({ queryKey: ['relevant'] })
          void queryClient.invalidateQueries({ queryKey: ['mine-intents'] })
        }
        if (event.type === 'notify' || event.type.startsWith('arrangement.') || event.type === 'slot.vacated') {
          void queryClient.invalidateQueries({ queryKey: ['arrangements'] })
        }
        if (event.type === 'negotiation.round') {
          const id = (seq += 1)
          const at = Date.now()
          liveRounds.push({ event, id, at })
          if (historyLoaded) setConversations((prev) => addRound(prev, event, id, at))
        }
        const said = chatFor(event, queryClient.getQueryData<MyIntent[]>(['mine-intents']))
        if (said) postChat(said)
        const line = describe(event)
        if (line) {
          setFeed((prev) => [{ id: (seq += 1), at: Date.now(), ...line }, ...prev].slice(0, FEED_CAP))
        }
      },
    })
    return unsubscribe
  }, [api, queryClient, postChat])

  const value = useMemo(() => ({ up, feed, conversations, chat, postChat, clearChat }), [up, feed, conversations, chat, postChat, clearChat])
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
