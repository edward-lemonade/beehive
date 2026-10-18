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
  // Saves run in order so a clear never lands after the messages that follow it.
  const saves = useRef<Promise<unknown>>(Promise.resolve())
  const loaded = useRef<Promise<void>>(Promise.resolve())
  const persist = useCallback((task: () => Promise<unknown>) => {
    saves.current = saves.current.then(() => loaded.current).then(task).catch(() => {})
  }, [])
  const postChat = useCallback((message: ChatInput) => {
    chatSeq.current += 1
    const id = chatSeq.current
    setChat((prev) => appendChat(prev, message, id, Date.now()))
    const { key, arrangementId, suggest } = message
    persist(() => api.saveChatMessage({ from: message.from, text: message.text, ...(key ? { key } : {}), ...(arrangementId ? { arrangementId } : {}), ...(suggest ? { suggest } : {}) }))
  }, [api, persist])

  const clearChat = useCallback(() => {
    setChat([])
    persist(() => api.clearChatMessages())
  }, [api, persist])

  const loadChat = useCallback(() => api.chatMessages().then((stored) => {
    setChat((prev) => {
      const have = new Set(prev.map((m) => m.key).filter(Boolean))
      const fresh = stored.filter((m) => !m.key || !have.has(m.key))
      if (fresh.length === 0) return prev
      const restored = fresh.map((m) => ({ ...m, id: (chatSeq.current += 1) }))
      return [...restored, ...prev].sort((x, y) => x.at - y.at).slice(-300)
    })
  }, () => {}), [api])

  useEffect(() => {
    loaded.current = loadChat()
  }, [loadChat])

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
        if (event.type === 'chat.message') void loadChat()
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
  }, [api, queryClient, postChat, loadChat])

  const value = useMemo(() => ({ up, feed, conversations, chat, postChat, clearChat }), [up, feed, conversations, chat, postChat, clearChat])
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
