import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryArrangementRepository, setArrangementRepository } from '../src/arrangements/repository.js';
import { makeEnvelope } from '../src/runtime/bus.js';
import { conversationLogIdle, logBlocked, logDeal, logRound, logToolCall } from '../src/observability/conversation.js';
const owners = vi.hoisted(() => ({ 'i-dawg': 'dawg', 'i-ed': 'edward' }));
vi.mock('../src/intents/service.js', () => ({
    getIntentRepository: () => ({ get: async (id) => (owners[id] ? { public: { ownerHandle: owners[id] } } : undefined) }),
}));
const sink = vi.hoisted(() => ({ lines: [], client: true }));
vi.mock('../src/observability/telemetry.js', async (importOriginal) => {
    const real = await importOriginal();
    const push = (level) => (message, attrs) => { sink.lines.push({ level, message, attrs }); };
    return {
        ...real,
        Sentry: {
            ...real.Sentry,
            getClient: () => (sink.client ? {} : undefined),
            getActiveSpan: () => undefined,
            withActiveSpan: (_span, fn) => fn(),
            logger: { info: push('info'), warn: push('warn') },
        },
    };
});
let lines;
beforeEach(() => {
    sink.lines.length = 0;
    sink.client = true;
    lines = sink.lines;
});
afterEach(() => {
    setArrangementRepository();
});
describe('conversation transcript', () => {
    it('logs agent↔agent rounds, tool calls and deal terms in order with handles', async () => {
        const repo = new MemoryArrangementRepository();
        setArrangementRepository(repo);
        await repo.save({
            id: 'arr-1',
            slots: [{ intentId: 'i-dawg', intentVersion: 1, approval: 'approved' }, { intentId: 'i-ed', intentVersion: 1, approval: 'approved' }],
            links: [{
                    id: 'i-dawg|i-ed', a: 'i-dawg', b: 'i-ed', payer: 'i-ed', amountCents: 20000, state: 'agreed',
                    flows: [{ from: 'i-dawg', to: 'i-ed', item: { kind: 'ticket', label: '3-day ticket', attrs: {}, qty: 1 } }],
                }],
        });
        logRound({ arrangementId: 'arr-1', linkId: 'i-dawg|i-ed', round: 1, fromIntentId: 'i-ed', toIntentId: 'i-dawg', kind: 'offer', amountCents: 20000, text: null });
        logRound({ arrangementId: 'arr-1', linkId: 'i-dawg|i-ed', round: 1, fromIntentId: 'i-dawg', toIntentId: 'i-ed', kind: 'say', amountCents: null, text: 'Deal at $200.' });
        logToolCall({ handle: 'dawg', action: { type: 'approve_arrangement', arrangementId: 'arr-1' }, result: 'Approved.', outcome: 'ok', durationMs: 12 });
        logDeal('committed', 'arr-1');
        await conversationLogIdle();
        expect(lines.map((l) => l.message)).toEqual([
            "[agent↔agent] @edward's agent → @dawg's agent: offers $200 (round 1)",
            `[agent↔agent] @dawg's agent → @edward's agent: "Deal at $200."`,
            "[tool] @dawg's agent ran approve_arrangement(arrangementId=arr-1) → ok: Approved.",
            '[deal] COMMITTED · deal arr-1: @dawg gives 3-day ticket to @edward, @edward pays @dawg $200',
        ]);
        expect(lines.map((l) => l.attrs['conv.seq'])).toEqual([...lines.map((l) => l.attrs['conv.seq'])].sort((a, b) => Number(a) - Number(b)));
        expect(lines[0].attrs).toMatchObject({ 'conv.channel': 'agent_agent', 'conv.amount_usd': 200, 'arrangement.id': 'arr-1' });
        expect(lines[3].attrs).toMatchObject({ 'conv.channel': 'deal', 'conv.total_usd': 200, 'conv.participants': '@dawg, @edward' });
    });
    it('records a guard-blocked line without the leaked words', async () => {
        logBlocked(makeEnvelope('i-dawg', 'i-ed', { type: 'say', linkId: 'l', text: 'my floor is $180' }), 'content');
        await conversationLogIdle();
        expect(lines).toHaveLength(1);
        expect(lines[0].level).toBe('warn');
        expect(lines[0].message).not.toContain('180');
        expect(lines[0].attrs['conv.text']).toBeUndefined();
    });
    it('describes unpriced cash as a seller price-setting step, not a zero-price payment', async () => {
        const repo = new MemoryArrangementRepository();
        setArrangementRepository(repo);
        await repo.save({
            id: 'arr-unpriced',
            slots: [{ intentId: 'i-dawg', intentVersion: 1, approval: 'queued' }, { intentId: 'i-ed', intentVersion: 1, approval: 'queued' }],
            links: [{
                    id: 'i-dawg|i-ed', a: 'i-dawg', b: 'i-ed', payer: 'i-ed', amountCents: null, state: 'agreed',
                    flows: [{ from: 'i-dawg', to: 'i-ed', item: { kind: 'ticket', label: '3-day ticket', attrs: {}, qty: 1 } }],
                }],
        });
        logDeal('proposed', 'arr-unpriced');
        await conversationLogIdle();
        expect(lines).toHaveLength(1);
        expect(lines[0].message).toContain('price not set; seller @dawg must name the asking price; buyer @edward is waiting');
        expect(lines[0].message).not.toContain('pays @dawg no price');
        expect(lines[0].attrs['conv.total_usd']).toBeUndefined();
    });
    it('is silent when Sentry is not initialised', async () => {
        sink.client = false;
        logRound({ round: 1, fromIntentId: 'i-dawg', toIntentId: 'i-ed', kind: 'walk' });
        await conversationLogIdle();
        expect(lines).toHaveLength(0);
    });
});
