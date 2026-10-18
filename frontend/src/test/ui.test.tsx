import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../api/client'
import { ApiContext } from '../api/context'
import { createMockApi, mockPublicIntents, XSS_TEXT } from '../api/mock'
import { parseSse, type StreamEvent } from '../api/stream'
import { IntentCard, PublicIntents } from '../feed/PublicIntents'
import { LiveProvider } from '../hooks/live'
import { addRound, appendChat, chatFor, describe as describeEvent } from '../hooks/liveContext'
import { nextSuggestion, roleOf } from '../lib/agentSpeech'
import { AgentChat } from '../panels/AgentChat'
import { AgentWindow } from '../panels/AgentWindow'
import { dollarsToCents } from '../lib/format'
import { ApprovalCard } from '../panels/Approvals'

function wrap(api: Api, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ApiContext.Provider value={api}>{ui}</ApiContext.Provider>
    </QueryClientProvider>,
  )
}

describe('public feed', () => {
  it('renders 30 mocked cards with no console errors', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    wrap(createMockApi(), <PublicIntents />)
    await waitFor(() => expect(screen.getAllByTestId('intent-card')).toHaveLength(30))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('renders markup in free text as visible text and creates no elements', async () => {
    const intent = mockPublicIntents(4)[3]!
    const { container } = wrap(createMockApi(), <ul><IntentCard intent={intent} own={false} /></ul>)
    expect(screen.getByText(XSS_TEXT)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows no message button for a non-relevant intent', async () => {
    const intent = mockPublicIntents(2)[1]!
    wrap(createMockApi(), <ul><IntentCard intent={intent} own={false} /></ul>)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await screen.findByText('Not a possible trade for your intents')
    expect(screen.queryByText('Message their agent')).toBeNull()
  })

  it('shows the message button for a relevant intent', async () => {
    const intent = mockPublicIntents(1)[0]!
    wrap(createMockApi(), <ul><IntentCard intent={intent} own={false} /></ul>)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText('Message their agent')).toBeInTheDocument()
    expect(screen.getByText('user-written')).toBeInTheDocument()
  })
})

describe('approvals', () => {
  it('shows terms and approves', async () => {
    const api = createMockApi()
    const spy = vi.spyOn(api, 'arrangementAction')
    const [entry] = await api.arrangements()
    wrap(api, <ul><ApprovalCard entry={entry!} /></ul>)
    expect(screen.getByText(/Includes 1 other participant you will not deal with/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('arr-1', 'approve', undefined))
  })

  it('shows contacts and a tickable checklist after commit', async () => {
    const api = createMockApi()
    await api.arrangementAction('arr-1', 'approve')
    const [entry] = await api.arrangements()
    wrap(api, <ul><ApprovalCard entry={entry!} /></ul>)
    expect(screen.getByText(/Otter-1002 \+1 555 0100/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
  })
})

describe('stream helpers', () => {
  it('parses sse frames and keeps the partial remainder', () => {
    const seen: StreamEvent[] = []
    const rest = parseSse('event: connected\ndata: {"a":1}\n\n: ping\n\nevent: notify\ndata: {"kind":"x"}\n\nevent: par', (e) => seen.push(e))
    expect(seen).toEqual([{ type: 'connected', data: { a: 1 } }, { type: 'notify', data: { kind: 'x' } }])
    expect(rest).toBe('event: par')
  })

  it('folds negotiation rounds into per-agent conversations', () => {
    const round = (data: Record<string, unknown>) => ({ type: 'negotiation.round', data: { fromIntentId: 'me', toIntentId: 'them', fromHandle: 'Me', toHandle: 'Bob', fromMine: true, ...data } })
    expect(describeEvent(round({ kind: 'offer' }))).toBeNull()
    let convs = addRound([], round({ kind: 'offer', amountCents: 30000 }), 1, 1)
    convs = addRound(convs, round({ kind: 'say', text: 'How about this?' }), 2, 2)
    convs = addRound(convs, round({ kind: 'accept', amountCents: 30000, fromIntentId: 'them', toIntentId: 'me', fromHandle: 'Bob', toHandle: 'Me', fromMine: false }), 3, 3)
    expect(convs).toHaveLength(1)
    expect(convs[0].handle).toBe('Bob')
    expect(convs[0].messages.map((m) => [m.mine, m.kind, m.text])).toEqual([[true, 'offer', 'How about this?'], [false, 'accept', null]])
  })

  it('reads a price out of free text', () => {
    expect(dollarsToCents('Does $280 work?')).toBe(28000)
    expect(dollarsToCents('1,250.50')).toBe(125050)
    expect(dollarsToCents('please lower it')).toBeNull()
  })
})

describe('agent speech', () => {
  const intent = (give: string, want: string) => ({
    give: [{ kind: give, label: give, attrs: {}, qty: 1 }],
    want: [{ anyOf: [{ kind: want, label: want, attrs: {}, qty: 1 }] }],
  }) as never

  it('knows buyers from sellers and suggests in the right direction', () => {
    expect(roleOf(intent('cash', 'ticket'))).toBe('payer')
    expect(roleOf(intent('ticket', 'cash'))).toBe('receiver')
    expect(nextSuggestion(30000, 'payer')).toBeLessThan(30000)
    expect(nextSuggestion(30000, 'receiver')).toBeGreaterThan(30000)
  })

  it('turns events into agent messages and dedupes by key', () => {
    const need = chatFor({ type: 'notify', data: { kind: 'needs_user', side: 'payer', amountCents: 30000, counterpartHandle: 'Bob', arrangementId: 'a1' } }, [])
    expect(need?.text).toContain('Bob won\'t go below $300')
    expect(chatFor({ type: 'notify', data: { kind: 'near_miss' } }, [])).toBeNull()
    let chat = appendChat([], need!, 1, 1)
    chat = appendChat(chat, need!, 2, 2)
    expect(chat).toHaveLength(1)
  })
})

describe('agent chat', () => {
  it('greets and talks to the agent without posting a listing', async () => {
    const api = createMockApi()
    const confirm = vi.spyOn(api, 'confirmDraft')
    wrap(api, <LiveProvider><AgentChat /></LiveProvider>)
    expect(await screen.findByText(/I'm your agent/)).toBeInTheDocument()
    expect(await screen.findByText(/found a match/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Message your agent'), { target: { value: 'selling a ticket' } })
    fireEvent.click(screen.getByText('Send'))
    expect(await screen.findByText(/Mock agent here/)).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('shows the arrangement card inside the chat and reports a final price', async () => {
    const api = createMockApi()
    wrap(api, <LiveProvider><AgentChat /></LiveProvider>)
    fireEvent.click(await screen.findByText('Negotiate further'))
    fireEvent.change(screen.getByLabelText('Message to their agent'), { target: { value: 'Does $250 work?' } })
    fireEvent.click(screen.getByText('Ask'))
    expect(await screen.findByText(/is final/)).toBeInTheDocument()
  })

  it('switches to sms only after a phone is added', async () => {
    const api = createMockApi()
    wrap(api, <LiveProvider><AgentChat /></LiveProvider>)
    fireEvent.click(await screen.findByText('SMS'))
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+1 555 010 0100' } })
    fireEvent.click(screen.getByText('Use SMS'))
    expect(await screen.findByText(/Your agent is texting you/)).toBeInTheDocument()
  })
})

describe('agent window', () => {
  it('starts collapsed and opens on click', () => {
    wrap(createMockApi(), <LiveProvider><AgentWindow /></LiveProvider>)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show agent conversations'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
