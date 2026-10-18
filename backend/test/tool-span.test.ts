import { describe, expect, it, vi } from 'vitest';

const sink = vi.hoisted(() => ({ spans: [] as Array<{ op?: string; attrs: Record<string, unknown>; status?: { message?: string } }>, exceptions: [] as unknown[] }));
vi.mock('../src/observability/telemetry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/observability/telemetry.js')>();
  return {
    ...real,
    Sentry: {
      ...real.Sentry,
      startSpan: (opts: { op?: string; attributes?: Record<string, unknown> }, fn: (span: unknown) => unknown) => {
        const rec: (typeof sink.spans)[number] = { op: opts.op, attrs: { ...opts.attributes } };
        sink.spans.push(rec);
        return fn({ setAttribute: (k: string, v: unknown) => { rec.attrs[k] = v; }, setAttributes: (a: Record<string, unknown>) => Object.assign(rec.attrs, a), setStatus: (s: { message?: string }) => { rec.status = s; } });
      },
      captureException: (e: unknown) => { sink.exceptions.push(e); },
    },
  };
});
vi.mock('../src/arrangements/service.js', () => ({ negotiateFurther: vi.fn(), approve: vi.fn(async () => { throw new Error('db down'); }), decline: vi.fn(), retract: vi.fn(), listMine: async () => [{ terms: { arrangementId: 'arr-1', state: 'proposed', approval: 'requested', gives: [], gets: [], cashOut: [], cashIn: [{ fromHandle: 'edward', amountCents: 20000 }] } }] }));
vi.mock('../src/arrangements/repository.js', () => ({ arrangementRepo: () => ({ revive: async () => {}, get: async () => null }) }));
vi.mock('../src/negotiation/log.js', () => ({ negotiationLog: () => ({ forIntents: async () => [] }) }));
vi.mock('../src/negotiation/service.js', () => ({ negotiateDirect: vi.fn() }));
vi.mock('../src/runtime/registry.js', () => ({ ensureAgent: () => {}, scheduler: { wake: () => {} } }));
vi.mock('../src/intents/service.js', () => ({
  listMine: async () => [], listPublicIntents: async () => [], setStandingLimit: vi.fn(), createDraft: vi.fn(), answerDraft: vi.fn(), confirmDraft: vi.fn(), getOwnedDraft: vi.fn(),
  getIntentRepository: () => ({ get: async () => undefined }),
}));

const { runAgentChat, setChatCompleter } = await import('../src/agent/chat.js');
const user = { id: 'u1', handle: 'me', tier: 'new' };
const toolSpans = () => sink.spans.filter((s) => s.op === 'gen_ai.execute_tool');

describe('execute_tool spans', () => {
  it('record arguments, a reason code for refusals, and the exception behind a failure', async () => {
    const script = [
      JSON.stringify({ reply: '', action: { type: 'approve_arrangement', arrangementId: 'arr-1', amountCents: 100 } }),
      JSON.stringify({ reply: '', action: { type: 'approve_arrangement', arrangementId: 'arr-1', amountCents: 20000 } }),
      JSON.stringify({ reply: 'Something went wrong.', action: null }),
    ];
    setChatCompleter(async () => script.shift()!);
    await runAgentChat({ user, message: 'yes', history: [] });
    const [refused, failed] = toolSpans();
    expect(refused!.attrs).toMatchObject({ 'tool.outcome': 'blocked', 'tool.reason': 'price_mismatch', 'arrangement.id': 'arr-1', 'gen_ai.tool.call.arguments': '{"arrangementId":"arr-1","amountCents":100}' });
    expect(refused!.status?.message).toBe('blocked: price_mismatch');
    expect(failed!.attrs).toMatchObject({ 'tool.outcome': 'failed', 'tool.reason': 'exception' });
    expect(failed!.status?.message).toBe('failed: exception');
    expect(sink.exceptions).toEqual([expect.objectContaining({ message: 'db down' })]);
    expect(refused!.attrs['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('redacts private limits in arguments unless LLM I/O recording is on', async () => {
    sink.spans.length = 0;
    const script = [JSON.stringify({ reply: '', action: { type: 'set_limit', intentId: 'i1', minCents: 9000 } }), JSON.stringify({ reply: 'ok', action: null })];
    setChatCompleter(async () => script.shift()!);
    await runAgentChat({ user, message: 'never below 90', history: [] });
    expect(toolSpans()[0]!.attrs['gen_ai.tool.call.arguments']).toBe('{"intentId":"i1","minCents":"[redacted]"}');
  });
});
