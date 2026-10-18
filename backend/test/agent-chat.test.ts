import { beforeEach, describe, expect, it, vi } from 'vitest';

const negotiateDirect = vi.fn(async () => ({ status: 'agreed', amountCents: 9000, rounds: 2 }));
const negotiateFurther = vi.fn();
const approve = vi.fn(async () => {});
const pending = { terms: { arrangementId: 'arr-1', state: 'proposed', approval: 'requested', gives: [], gets: [], cashOut: [], cashIn: [] } };
const createDraft = vi.fn(async (_u: string, text: string) => ({
  id: 'd1', missing: [], question: null,
  parsed: { give: [{ kind: 'ticket', label: text, attrs: {}, qty: 1 }], want: [{ anyOf: [{ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents: 8000 }] }] },
}));

vi.mock('../src/negotiation/service.js', () => ({ negotiateDirect }));
vi.mock('../src/arrangements/service.js', () => ({ negotiateFurther, approve, decline: vi.fn(), retract: vi.fn(), listMine: async () => [pending] }));
vi.mock('../src/arrangements/repository.js', () => ({ arrangementRepo: () => ({ revive: async () => {}, get: async () => null }) }));
vi.mock('../src/runtime/registry.js', () => ({ ensureAgent: () => {}, scheduler: { wake: () => {} } }));
vi.mock('../src/intents/service.js', () => ({
  listMine: async () => [{ id: 'mine-1', state: 'open', public: { freeText: 'selling a saturday niteharts ticket for $100' } }],
  listPublicIntents: async () => [{ intentId: 'edward-1', ownerHandle: 'edward', freeText: 'looking for a saturday niteharts ticket' }],
  createDraft, answerDraft: vi.fn(), confirmDraft: vi.fn(), getOwnedDraft: vi.fn(),
  getIntentRepository: () => ({ get: async () => undefined }),
}));

const { runAgentChat, setChatCompleter } = await import('../src/agent/chat.js');
const user = { id: 'u1', handle: 'me', tier: 'new' };

beforeEach(() => {
  vi.clearAllMocks();
  setChatCompleter(undefined);
});

describe('agent chat', () => {
  it('sees the listings, acts on them, then answers using the tool result', async () => {
    const prompts: string[] = [];
    const script = [
      JSON.stringify({ reply: '', action: { type: 'message_agent', ownIntentId: 'mine-1', targetIntentId: 'edward-1', targetCents: 9000 } }),
      JSON.stringify({ reply: 'edward is in at $90. Want me to lock it in?', action: null }),
    ];
    setChatCompleter(async (messages) => {
      prompts.push(messages.map((m) => m.content).join('\n'));
      return script.shift()!;
    });
    const out = await runAgentChat({ user, message: 'what about edward, who is looking for a ticket. I am selling one for $90', history: [] });
    expect(prompts[0]).toContain('edward');
    expect(prompts[0]).toContain('mine-1');
    expect(negotiateDirect).toHaveBeenCalledWith('u1', { ownIntentId: 'mine-1', targetIntentId: 'edward-1', targetCents: 9000 });
    expect(prompts[1]).toContain('TOOL RESULT');
    expect(out.reply).toBe('edward is in at $90. Want me to lock it in?');
    expect(out.changed).toBe(true);
  });

  it('never creates listings, and rejects arrangements that are not theirs', async () => {
    const script = [
      JSON.stringify({ reply: '', action: { type: 'create_draft', text: 'selling a ticket for $80' } }),
      JSON.stringify({ reply: 'Use the New intent box to list it.', action: null }),
    ];
    setChatCompleter(async () => script.shift()!);
    const out = await runAgentChat({ user, message: 'selling a ticket for $80', history: [] });
    expect(createDraft).not.toHaveBeenCalled();
    expect(out.draft).toBeNull();

    const second = [
      JSON.stringify({ reply: '', action: { type: 'negotiate_arrangement', arrangementId: 'nope', targetCents: 100 } }),
      JSON.stringify({ reply: 'I could not find that deal.', action: null }),
    ];
    setChatCompleter(async () => second.shift()!);
    await runAgentChat({ user, message: 'lower it', history: [] });
    expect(negotiateFurther).not.toHaveBeenCalled();
  });

  it('speaks about events without a user message', async () => {
    let sent = '';
    setChatCompleter(async (messages) => {
      sent = messages[messages.length - 1]!.content;
      return JSON.stringify({ reply: 'Bob will not go below $300.', action: null });
    });
    const out = await runAgentChat({ user, event: { kind: 'needs_user', amountCents: 30000 }, history: [] });
    expect(sent).toContain('EVENT');
    expect(out.reply).toContain('$300');
  });

  it('approves from a plain yes, but never from an event', async () => {
    const yes = [
      JSON.stringify({ reply: '', action: { type: 'approve_arrangement', arrangementId: 'arr-1' } }),
      JSON.stringify({ reply: 'Done, waiting on them.', action: null }),
    ];
    setChatCompleter(async () => yes.shift()!);
    await runAgentChat({ user, message: 'sure', history: [] });
    expect(approve).toHaveBeenCalledWith('u1', 'arr-1');

    approve.mockClear();
    const ev = [
      JSON.stringify({ reply: '', action: { type: 'approve_arrangement', arrangementId: 'arr-1' } }),
      JSON.stringify({ reply: 'There is a deal waiting for you.', action: null }),
    ];
    setChatCompleter(async () => ev.shift()!);
    await runAgentChat({ user, event: { kind: 'approval_request' }, history: [] });
    expect(approve).not.toHaveBeenCalled();
  });
});
