import { z } from 'zod'
import type { IntentPublic, NearMiss } from '../contracts'
import {
  draftSchema,
  intentPublicSchema,
  mineEntrySchema,
  myIntentSchema,
  nearMissSchema,
  channelSchema,
  actionResultSchema,
  negotiateResultSchema,
  relevantSchema,
  type ActionResult,
  type ChannelState,
  type Draft,
  type MineEntry,
  type MyIntent,
  type NegotiateResult,
  type Relevant,
} from './schemas'
import { openStream, type StreamEvent, type StreamHandlers } from './stream'

export type ArrangementAction = 'approve' | 'decline' | 'retract' | 'decline-withdraw' | 'negotiate-further'

export type AgentChatInput = {
  message?: string
  event?: Record<string, unknown>
  history: { from: 'agent' | 'me'; text: string }[]
  draftId?: string | null
}
export type AgentChatResult = { reply: string; draft: Draft | null; changed: boolean }

export type StoredChat = { from: 'agent' | 'me'; text: string; key?: string; arrangementId?: string; suggest?: { arrangementId: string; cents: number }; at: number }

const seedOptionSchema = z.object({ id: z.string(), label: z.string(), description: z.string() })
export type SeedOption = z.infer<typeof seedOptionSchema>

export type Api = {
  chatMessages(): Promise<StoredChat[]>
  saveChatMessage(message: Omit<StoredChat, 'at'>): Promise<void>
  clearChatMessages(): Promise<void>
  publicIntents(): Promise<IntentPublic[]>
  myIntents(): Promise<MyIntent[]>
  createDraft(text: string): Promise<Draft>
  agentChat(input: AgentChatInput): Promise<AgentChatResult>
  seedOptions(): Promise<SeedOption[]>
  loadSeed(scenarioId?: string): Promise<void>
  answerDraft(id: string, text: string): Promise<Draft>
  confirmDraft(id: string): Promise<void>
  editIntent(id: string, text: string): Promise<void>
  withdraw(id: string): Promise<void>
  deleteIntent(id: string): Promise<void>
  reopen(id: string): Promise<Draft>
  keepLooking(id: string): Promise<void>
  nearMisses(id: string): Promise<NearMiss[]>
  relevant(id: string): Promise<Relevant>
  negotiate(ownIntentId: string, targetIntentId: string, targetCents?: number): Promise<NegotiateResult>
  arrangements(): Promise<MineEntry[]>
  arrangementAction(id: string, action: ArrangementAction, body?: { targetCents: number }): Promise<ActionResult>
  channel(): Promise<ChannelState>
  setChannel(channel: 'app' | 'sms'): Promise<ChannelState>
  setPhone(phone: string): Promise<ChannelState>
  requestPhoneLink(): Promise<{ code: string; phoneNumber: string }>
  contact(): Promise<string | null>
  setContact(contact: string): Promise<string>
  subscribe(handlers: StreamHandlers): () => void
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:3000'

export type TokenGetter = () => Promise<string | null>

export function createHttpApi(getToken: TokenGetter, baseUrl = API_URL): Api {
  async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
    const token = await getToken()
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok || data.ok === false) {
      throw new ApiError(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`, response.status)
    }
    return data
  }
  const post = (path: string, body?: unknown) => request(path, { method: 'POST', body: body ?? {} })

  return {
    publicIntents: async () => z.array(intentPublicSchema).parse((await request('/map/intents')).intents),
    myIntents: async () => z.array(myIntentSchema).parse((await request('/intents/mine')).intents),
    agentChat: async (input) => {
      const r = await post('/agent/chat', input)
      return { reply: z.string().parse(r.reply), draft: draftSchema.nullable().parse(r.draft ?? null), changed: Boolean(r.changed) }
    },
    chatMessages: async () => z.array(z.object({
      from: z.enum(['agent', 'me']),
      text: z.string(),
      key: z.string().optional(),
      arrangementId: z.string().optional(),
      suggest: z.object({ arrangementId: z.string(), cents: z.number() }).optional(),
      at: z.number(),
    })).parse((await request('/agent/messages')).messages),
    saveChatMessage: async (message) => void (await post('/agent/messages', message)),
    clearChatMessages: async () => void (await request('/agent/messages', { method: 'DELETE' })),
    seedOptions: async () => z.array(seedOptionSchema).parse((await request('/dev/seeds')).scenarios),
    loadSeed: async (scenarioId) => void (await post('/dev/seed', { scenarioId })),
    createDraft: async (text) => draftSchema.parse((await post('/intents/draft', { text })).draft),
    answerDraft: async (id, text) => draftSchema.parse((await post(`/intents/draft/${id}/answer`, { text })).draft),
    confirmDraft: async (id) => void (await post(`/intents/draft/${id}/confirm`)),
    editIntent: async (id, text) => void (await request(`/intents/${id}`, { method: 'PATCH', body: { text } })),
    deleteIntent: async (id) => void (await request(`/intents/${id}`, { method: 'DELETE' })),
    withdraw: async (id) => void (await post(`/intents/${id}/withdraw`)),
    reopen: async (id) => draftSchema.parse((await post(`/intents/${id}/reopen`)).draft),
    keepLooking: async (id) => void (await post(`/intents/${id}/keep-looking`)),
    nearMisses: async (id) => z.array(nearMissSchema).parse((await request(`/intents/${id}/near-misses`)).nearMisses),
    relevant: async (id) => relevantSchema.parse(await request(`/intents/${id}/relevant`)),
    negotiate: async (ownIntentId, targetIntentId, targetCents) =>
      negotiateResultSchema.parse(await post('/negotiate', { ownIntentId, targetIntentId, ...(targetCents !== undefined ? { targetCents } : {}) })),
    arrangements: async () => z.array(mineEntrySchema).parse((await request('/arrangements/mine')).arrangements),
    arrangementAction: async (id, action, body) => {
      const data = actionResultSchema.parse(await post(`/arrangements/${id}/${action}`, body))
      if (data.status === 'failed') return { status: 'failed', ...(data.reason ? { reason: data.reason } : {}) }
      if (data.status === 'pending') return { status: 'pending', ...(data.amountCents !== undefined ? { amountCents: data.amountCents } : {}) }
      const cents = data.terms?.cashOut[0]?.amountCents ?? data.terms?.cashIn[0]?.amountCents
      return { status: data.status === 'agreed' ? 'agreed' : 'ok', ...(cents !== undefined ? { amountCents: cents } : {}) }
    },
    channel: async () => channelSchema.parse(await request('/me/channel')),
    setChannel: async (channel) => channelSchema.parse(await post('/me/channel', { channel })),
    requestPhoneLink: async () => {
      const r = await post('/me/link-code')
      return { code: z.string().length(4).parse(r.code), phoneNumber: z.string().parse(r.phoneNumber) }
    },
    contact: async () => ((await request('/me/contact')).contact as string | null) ?? null,
    setContact: async (contact) => (await post('/me/contact', { contact })).contact as string,
    setPhone: async (phone) => channelSchema.parse(await post('/me/phone', { phone })),
    subscribe: (handlers) => openStream(`${baseUrl}/stream`, getToken, handlers),
  }
}

export type { StreamEvent }
