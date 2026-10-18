import type { IntentPublic } from '../contracts'
import type { Api } from './client'
import type { Draft, MineEntry, MyIntent } from './schemas'

export const XSS_TEXT = '<img src=x onerror=alert(1)>'

const kinds = ['ticket', 'sublet', 'other'] as const

export function mockPublicIntents(count = 30): IntentPublic[] {
  return Array.from({ length: count }, (_, i) => ({
    intentId: `mock-${i}`,
    version: 0,
    ownerHandle: `Otter-${String(1000 + i)}`,
    ownerImageUrl: null,
    tier: i % 5 === 0 ? 'trusted' : 'new',
    give: [{ kind: kinds[i % 3], label: `Item ${i}`, attrs: {}, qty: 1 }],
    want: [{ anyOf: [{ kind: 'cash' as const, label: 'cash', attrs: {}, qty: 1, amountCents: 5000 + i * 100 }] }],
    deadline: null,
    freeText:
      i === 3
        ? XSS_TEXT
        : `Trading item ${i} for cash. This is a longer description so truncation has something to cut off, with extra words to pad it out.`,
  }))
}

const mineIntents: MyIntent[] = [
  { id: 'mock-0', version: 0, state: 'open', public: mockPublicIntents(1)[0]!, private: { minNetCents: null, declaredNetCents: null } },
]

const terms: MineEntry = {
  terms: {
    arrangementId: 'arr-1',
    revision: 1,
    intentId: 'mock-0',
    intentVersion: 0,
    state: 'proposed',
    approval: 'requested',
    expiresAt: Date.now() + 3_600_000,
    gives: [{ item: { kind: 'ticket', label: 'Concert ticket', attrs: {}, qty: 1 }, toHandle: 'Otter-1001' }],
    gets: [{ item: { kind: 'sublet', label: 'Summer sublet', attrs: {}, qty: 1 }, fromHandle: 'Otter-1002' }],
    cashOut: [],
    cashIn: [{ fromHandle: 'Otter-1001', amountCents: 5000 }],
    netCents: 5000,
    declaredNetCents: 5000,
    grade: 'exact',
    otherParticipants: 1,
  },
  contacts: null,
}

export function createMockApi(): Api {
  let committed = false
  let sms = false
  let phone = false
  let contact: string | null = 'me@example.com'
  const draft: Draft = {
    id: 'draft-1',
    parsed: { give: [], want: [], deadline: null, minNetCents: null, declaredNetCents: null, separateOrTogether: null, injectionSuspected: false, injectionReason: null },
    missing: [],
    question: null,
  }
  return {
    publicIntents: async () => mockPublicIntents(),
    myIntents: async () => mineIntents,
    history: async () => [],
    agentChat: async ({ message }) => ({ reply: message ? `Mock agent here. You said: ${message}` : 'Mock agent here.', draft: null, changed: false }),
    chatMessages: async () => [],
    saveChatMessage: async () => {},
    clearChatMessages: async () => {},
    loadSeed: async () => {},
    createDraft: async () => draft,
    answerDraft: async () => draft,
    confirmDraft: async () => {},
    editIntent: async () => {},
    withdraw: async () => {},
    deleteIntent: async () => {},
    reopen: async () => draft,
    keepLooking: async () => {},
    nearMisses: async () => [],
    relevant: async (id) => (Number(id.split('-')[1]) % 2 === 0 ? { relevant: true, ownIntentId: 'mock-0' } : { relevant: false, ownIntentId: null }),
    negotiate: async () => ({ status: 'agreed', amountCents: 5000, rounds: 2 }),
    arrangements: async () => [
      committed
        ? { terms: { ...terms.terms, state: 'committed', approval: 'fulfilled' }, contacts: [{ handle: 'Otter-1002', contact: 'otter@example.com' }] }
        : terms,
    ],
    arrangementAction: async (_id, action, body) => {
      if (action === 'approve') committed = true
      if (action === 'negotiate-further') return body?.targetCents === 25000 ? { status: 'failed', reason: 'no_agreement' } : { status: 'agreed', amountCents: body?.targetCents ?? 4500 }
      return { status: 'ok' }
    },
    channel: async () => ({ channel: sms ? 'sms' : 'app', phoneLinked: phone, phoneTail: phone ? '0100' : null }),
    contact: async () => contact,
    setContact: async (next) => {
      contact = next
      return next
    },
    setPhone: async () => {
      phone = true
      return { channel: sms ? 'sms' : 'app', phoneLinked: true, phoneTail: '0100' }
    },
    setChannel: async (next) => {
      if (next === 'sms' && !phone) throw new Error('Add a phone number before switching to SMS')
      sms = next === 'sms'
      return { channel: next, phoneLinked: phone, phoneTail: phone ? '0100' : null }
    },
    subscribe: ({ onStatus }) => {
      onStatus(true)
      return () => {}
    },
  }
}

export const isMock = (import.meta.env.VITE_MOCK as string | undefined) === '1'
